#!/usr/bin/env node
// skills/spec/scripts/test/spec-inventory.test.mjs — sitemap parsing (urlset vs index, locs, hreflang, lastmod) and path roots.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-inventory.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };
const helpCheck = (script) => check(`${script} --help prints usage and writes nothing`, () => {
  const cwd = mkdtempSync(join(tmpdir(), "spec-help-"));
  const r = spawnSync(process.execPath, ["--no-warnings", join(HERE, "..", script), "--help"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0); assert.ok(r.stdout.includes(script), "usage names the script");
  assert.deepEqual(readdirSync(cwd), []); rmSync(cwd, { recursive: true });
});
import { parseSitemap, rootOf, sampleBySection } from "../spec-inventory.mjs";
check("urlset: locs, lastmod years, not an index", () => { const s = parseSitemap(`<urlset><url><loc>https://example.com/a/b/c.html</loc><lastmod>2024-01-02</lastmod></url><url><loc> https://example.com/x?a=1&amp;b=2 </loc></url></urlset>`); assert.equal(s.isIndex, false); assert.deepEqual(s.locs, ["https://example.com/a/b/c.html", "https://example.com/x?a=1&b=2"]); assert.deepEqual(s.lastmod, ["2024"]); });
check("index detected", () => assert.equal(parseSitemap("<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>").isIndex, true));
check("rootOf keeps two segments", () => { assert.equal(rootOf("https://example.com/de/de/p.html"), "/de/de"); assert.equal(rootOf("https://example.com/"), "/"); });
check("sampleBySection: cap kept, every section present, proportional, deterministic", () => { const u = [...Array(90)].map((_, i) => `https://example.com/news/${i}`).concat([...Array(9)].map((_, i) => `https://example.com/about/${i}`), ["https://example.com/"]); const s = sampleBySection(u, 10, "/"); assert.equal(s.length, 10); assert.ok(s.some((x) => x.includes("/about/"))); assert.ok(s.includes("https://example.com/")); assert.ok(s.filter((x) => x.includes("/news/")).length >= 7); assert.deepEqual(sampleBySection(u, 10, "/"), s); assert.equal(sampleBySection(u, 500, "/").length, 100); });
helpCheck("spec-inventory.mjs");
process.exit(failed ? 1 : 0);
