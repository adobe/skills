#!/usr/bin/env node
// Fixture test: crawl.mjs slug derivation (ia-extraction.md § Slug derivation
// DESCRIBES the function under test; downstream scripts key on the slugs it
// writes, so its contract is pinned here).
//   root → `index`; non-[a-z0-9] runs → `-`, lowercased;
//   a 200+-char path → ≤ 200 chars, `<180-char prefix>-<sha1:8>`, stable;
//   collision → first claimant keeps the clean slug, later distinct pages get
//   a deterministic `-<hash4>`; query variants are distinct pages.
// Runs without playwright: crawl.mjs imports it lazily inside main().
// Usage: node plugins/stardust/evals/fixtures/crawl-slugify.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { slugify, assignSlugs } from '../../skills/extract/scripts/crawl.mjs';

const O = 'https://example.com';
assert.equal(slugify(`${O}/`), 'index', 'root → index');
assert.equal(slugify(O), 'index', 'bare origin → index');
assert.equal(slugify(`${O}/About/Us/`), 'about-us', 'lowercase, slashes → -');
assert.equal(slugify(`${O}/docs/api.html`), 'docs-api-html', 'every non-alnum run → -');
assert.equal(slugify(`${O}/p?a=1`), 'p', 'slugify reads pathname only');

const long = `${O}/${'segment-'.repeat(40)}end`; // 328-char path
const s1 = slugify(long);
assert.ok(s1.length <= 200, `long slug capped (got ${s1.length})`);
assert.match(s1, /^[a-z0-9-]{1,180}-[0-9a-f]{8}$/, 'cap = 180-char prefix + -<sha1:8>');
assert.equal(slugify(long), s1, 'cap is stable across calls');
assert.notEqual(slugify(`${long}x`), s1, 'different long paths hash differently');

const urls = [`${O}/about-us`, `${O}/about/us`, `${O}/p?a=1`, `${O}/p?a=2`, `${O}/`];
const slugs = assignSlugs(urls);
assert.equal(slugs[0], 'about-us', 'first claimant keeps the clean slug');
assert.match(slugs[1], /^about-us-[0-9a-f]{4}$/, 'later distinct page gets -<hash4>');
assert.equal(slugs[2], 'p', 'query variant 1 keeps the clean slug');
assert.match(slugs[3], /^p-[0-9a-f]{4}$/, 'query variant 2 is a distinct page');
assert.equal(slugs[4], 'index');
assert.deepEqual(assignSlugs(urls), slugs, 'assignment is deterministic');
assert.equal(new Set(slugs).size, slugs.length, 'no two pages share a slug');

console.log('crawl-slugify test: ok');
