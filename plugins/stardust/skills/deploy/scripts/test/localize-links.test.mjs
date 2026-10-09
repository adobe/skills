#!/usr/bin/env node
// skills/deploy/scripts/test/localize-links.test.mjs — the redirects reader: TSV with comments, JSON array and map, the published DA sheet, JSON Lines with src/target; incomplete rows skipped.
// Run: node plugins/stardust/skills/deploy/scripts/test/localize-links.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redirectPairs } from "../localize-links.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };
check("TSV with comments and blank lines", () => assert.deepEqual(redirectPairs("# renames\n/a/B_c\t/a/b-c\n\n/x  /y\n", "redirects.tsv"), [["/a/B_c", "/a/b-c"], ["/x", "/y"]]));
check("JSON array and map", () => {
  assert.deepEqual(redirectPairs(JSON.stringify([{ source: "/a", destination: "/b" }, { source: "/c" }]), "r.json"), [["/a", "/b"]]);
  assert.deepEqual(redirectPairs(JSON.stringify({ "/a": "/b" }), "r.json"), [["/a", "/b"]]);
});
check("the published DA sheet shape", () => assert.deepEqual(redirectPairs(JSON.stringify({ total: 1, data: [{ Source: "/a.html", Destination: "/a" }] }), "redirects.json"), [["/a.html", "/a"]]));
check("JSON Lines: spec knowledge rows (src/target); a null target is skipped", () => assert.deepEqual(redirectPairs('{"src":"/en/a.html","target":"/en/a","kind":"migration"}\n{"src":"https://example.com/old","target":null}\n', "redirects.jsonl"), [["/en/a.html", "/en/a"]]));
check("a redirect rewrites links only to a page of the content tree", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-r-")); const c = join(root, "content", "en"); mkdirSync(c, { recursive: true });
  writeFileSync(join(c, "a.html"), '<a href="https://example.com/en/old-a">a</a> <a href="https://example.com/en/old-b">b</a>');
  writeFileSync(join(root, "r.tsv"), "/en/old-a\t/en/a\n/en/old-b\t/en/b\n");
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", join(root, "content"), "--redirects", join(root, "r.tsv")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /1 redirect\(s\) to pages not in this tree/);
  assert.equal(readFileSync(join(c, "a.html"), "utf8"), '<a href="/en/a">a</a> <a href="https://example.com/en/old-b">b</a>');
  rmSync(root, { recursive: true });
});
check("--help prints usage", () => { const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--help"], { encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout + r.stderr, /localize-links/); });
process.exit(failed ? 1 : 0);
