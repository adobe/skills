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
import { readFileSync } from 'node:fs';
import { slugify, assignSlugs, MOBILE_SHOT_SUFFIX } from '../../skills/extract/scripts/crawl.mjs';

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

// the mobile shot is <slug>-360.png (extract/SKILL.md --mobile): a real page at
// /foo-360 must never share that file with /foo's 360 shot, whichever is queued first
assert.equal(MOBILE_SHOT_SUFFIX, '-360');
const noShotClash = (ss) => ss.every((s) => !ss.includes(`${s}${MOBILE_SHOT_SUFFIX}`));
const a = assignSlugs([`${O}/promo`, `${O}/promo-360`, `${O}/index-360`]);
assert.equal(a[0], 'promo'); assert.match(a[1], /^promo-360-[0-9a-f]{4}$/, 'a later page whose slug is <claimed>-360 is disambiguated');
assert.equal(a[2], 'index-360', 'index-360 is free while no page claims index');
assert.ok(noShotClash(a), `no slug may equal another slug + -360: ${a}`);
const b = assignSlugs([`${O}/promo-360`, `${O}/promo`]);
assert.equal(b[0], 'promo-360', 'first claimant keeps its clean slug even when it ends in -360');
assert.match(b[1], /^promo-[0-9a-f]{4}$/, 'the page whose 360 shot would collide with an existing slug is disambiguated instead');
assert.ok(noShotClash(b), `reverse order too: ${b}`);
assert.deepEqual(assignSlugs([`${O}/promo-360`, `${O}/promo`]), b, 'deterministic');
// the shot is WRITTEN through the same constant the guard reserves — a literal
// `${slug}-360` at the write site would drift silently on a width change
const crawlSrc = readFileSync(new URL('../../skills/extract/scripts/crawl.mjs', import.meta.url), 'utf8');
assert.equal((crawlSrc.match(/\$\{slug\}-360/g) || []).length, 0, 'crawl.mjs must not write `${slug}-360` literally — use MOBILE_SHOT_SUFFIX');
assert.ok(/\$\{slug\}\$\{MOBILE_SHOT_SUFFIX\}/.test(crawlSrc), 'the mobile shot file base is `${slug}${MOBILE_SHOT_SUFFIX}`');

console.log('crawl-slugify test: ok');
