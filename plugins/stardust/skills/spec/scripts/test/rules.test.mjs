#!/usr/bin/env node
// skills/spec/scripts/test/rules.test.mjs — the rule format: tokens and quoted lists, filters and globs, URL terms (live, sitemap, block, signal, nested, verdict, negation), count, sum, keyed and max lookups, value, fillText, errors that name the rule.
// Run: node plugins/stardust/skills/spec/scripts/test/rules.test.mjs
import assert from "node:assert/strict";
import { tokens, values, evalRule, selectUrls, fillText } from "../rules.mjs";
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };

const K = {
  urls: [
    { id: 1, url: "https://example.com/en/a.html", path: "/en/a.html", final_url: "https://example.com/en/a.html", in_sitemap: 1, outcome: "page", template: "page · a", flag: null, pageviews_90d: 10 },
    { id: 2, url: "https://example.com/en/b.html", path: "/en/b.html", final_url: "https://example.com/es/b.html", in_sitemap: 1, outcome: "page", template: "page · b", flag: "empty", pageviews_90d: 0 },
    { id: 3, url: "https://example.com/en/c.html", path: "/en/c.html", final_url: "https://example.com/en/c.html", in_sitemap: 0, outcome: "page", template: "page · a", flag: null, pageviews_90d: 0 },
    { id: 4, url: "https://example.com/en/old.html", path: "/en/old.html", final_url: "https://example.com/en/gone.html", in_sitemap: 1, outcome: "redirect-broken", template: null, flag: null, pageviews_90d: 0 },
  ],
  pageBlocks: [
    { url_id: 1, blocks: [{ pos: 0, block: "hero", variant: null, kind: "block", nested_in: null }, { pos: 1, block: "cards", variant: "3-up", kind: "block", nested_in: "tabs" }] },
    { url_id: 2, blocks: [{ pos: 0, block: "news-list", variant: null, kind: "dynamic", nested_in: null }] },
    { url_id: 3, blocks: [{ pos: 0, block: "hero", variant: null, kind: "block", nested_in: null }] },
  ],
  signals: [{ url_id: 1, signals: ["script:cdn.Player.example", "noindex"] }, { url_id: 2, signals: ["iframe:forms.example"] }],
  blocks: [
    { name: "hero", url_count: 1, variants: [{ variant: null, verdict: "reuse" }] },
    { name: "cards", url_count: 1, variants: [{ variant: "3-up", verdict: "new" }] },
    { name: "news-list", url_count: 1, variants: [{ variant: null, verdict: "variant" }] },
  ],
  templates: [{ id: "page · a", url_count: 1, variant_count: 3 }, { id: "page · b", url_count: 5, variant_count: 2 }],
  redirects: [{ src: "/x", kind: "legacy", status: 302, in_sitemap: 1 }, { src: "/y", kind: "migration", status: 301, in_sitemap: 1 }],
  locales: [],
};
const ids = (terms) => selectUrls(K, terms).map((u) => u.id);

check("tokens keep quotes and brackets together", () => assert.deepEqual(tokens('sum templates.x id="a b","c" templates[p · q].n'), ["sum", "templates.x", 'id="a b","c"', "templates[p · q].n"]));
check("values: quoted items keep commas and spaces", () => assert.deepEqual(values('a,"b c",\'d,e\''), ["a", "b c", "d,e"]));
check("live and sitemap; negation", () => { assert.deepEqual(ids("live sitemap"), [1, 2]); assert.deepEqual(ids("live !sitemap"), [3]); });
check("field filters: exact, list, glob (case-insensitive), null", () => {
  assert.deepEqual(ids("flag=empty"), [2]); assert.deepEqual(ids("outcome=page,redirect-broken sitemap"), [1, 2, 4]);
  assert.deepEqual(ids("final_url=*/ES/*"), [2]); assert.deepEqual(ids("live flag=null"), [1, 3]); assert.deepEqual(ids("template!=\"page · a\" live"), [2]);
});
check("block, block|variant, nested, signal glob, verdict", () => {
  assert.deepEqual(ids("block:hero"), [1, 3]); assert.deepEqual(ids("block:cards|3-up"), [1]); assert.deepEqual(ids("block:hero|"), [1, 3]);
  assert.deepEqual(ids("nested"), [1]); assert.deepEqual(ids("signal:script:*player*,iframe:forms.example"), [1, 2]);
  assert.deepEqual(ids("live sitemap !verdict:new"), [2]);
});
check("numbers: urls, count, sum, keyed and max lookups, value", () => {
  assert.equal(evalRule(K, "urls sitemap flag=empty"), 1); assert.equal(evalRule(K, "count redirects kind=legacy status=302"), 1);
  assert.equal(evalRule(K, 'sum templates.variant_count id="page · a","page · b"'), 5); assert.equal(evalRule(K, "sum locales.urls"), 0);
  assert.equal(evalRule(K, "templates[page · b].url_count"), 5); assert.equal(evalRule(K, "templates[max:url_count].variant_count"), 2);
  assert.equal(evalRule(K, "blocks[cards].url_count"), 1); assert.equal(evalRule(K, "value:7"), 7);
  assert.equal(evalRule(K, "count block-variants verdict=new"), 1); assert.equal(evalRule(K, "count page-blocks kind=block"), 3);
});
check("fillText resolves every placeholder with separators", () => {
  const f = fillText({ ...K, templates: [{ id: "t", url_count: 12345 }] }, "{{templates[t].url_count}} pages, {{count redirects}} redirects");
  assert.equal(f.text, "12,345 pages, 2 redirects"); assert.deepEqual(f.numbers, [12345, 2]);
});
check("errors name the rule: unknown term, set, field, key, form", () => {
  assert.throws(() => evalRule(K, "urls mystery"), /rule "urls mystery": unknown term "mystery"/);
  assert.throws(() => evalRule(K, "count nothing"), /unknown set "nothing"/);
  assert.throws(() => evalRule(K, "count redirects colour=red"), /unknown field "colour"/);
  assert.throws(() => evalRule(K, "blocks[absent].url_count"), /no blocks row "absent"/);
  assert.throws(() => evalRule(K, "SELECT COUNT(*) FROM url"), /unknown form/);
});
process.exit(failed ? 1 : 0);
