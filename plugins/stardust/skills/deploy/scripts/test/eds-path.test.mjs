#!/usr/bin/env node
// skills/deploy/scripts/test/eds-path.test.mjs — the delivered-path contract: folder index at /a/, leaf without slash, .html dropped, segments sanitised, // collapsed; DA path of a folder index; the lookup key; the two copies that import it agree.
// Run: node plugins/stardust/skills/deploy/scripts/test/eds-path.test.mjs
import assert from "node:assert/strict";
import { daPath, deliveredUrl, pathKey } from "../eds-path.mjs";
import { canonicalPath } from "../localize-links.mjs";
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };

check("deliveredUrl: leaf without slash, folder index with it, .html dropped, segments sanitised, // collapsed", () => {
  const cases = { "/a/B_c.html": "/a/b-c", "/a/index.html": "/a/", "/index.html": "/", "/": "/", "/a/b.c/": "/a/b-c/", "/a//b": "/a/b", "/About Us/Foo--Bar_": "/about-us/foo-bar", "/en/home.html?x=1#y": "/en/home", "/a/b.htm": "/a/b" };
  for (const [i, o] of Object.entries(cases)) assert.equal(deliveredUrl(i), o, i);
});
check("daPath: a folder index is the folder's index document", () => { assert.equal(daPath("/a/"), "/a/index"); assert.equal(daPath("/"), "/index"); assert.equal(daPath("/a/b"), "/a/b"); });
check("pathKey: one key for every spelling of a page", () => {
  for (const s of ["/a/", "/a", "/a/index", "/a/index.html", "/A?x#y"]) assert.equal(pathKey(s), "/a", s);
  assert.equal(pathKey("/"), "/"); assert.equal(pathKey("/index.html"), "/");
});
check("delivered URLs of a site and their keys never collide across a folder and its leaf twin", () => assert.notEqual(deliveredUrl("/a/index.html"), deliveredUrl("/a.html")));
check("localize-links' canonicalPath is this module's pathKey", () => assert.equal(canonicalPath, pathKey));
process.exit(failed ? 1 : 0);
