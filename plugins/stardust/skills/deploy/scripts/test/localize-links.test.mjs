#!/usr/bin/env node
// skills/deploy/scripts/test/localize-links.test.mjs — the redirects reader: TSV with comments, JSON array and map, the published DA sheet, JSON Lines with src/target; incomplete rows skipped; a missing --redirects file is a note, an unreadable one exit 1; --unit rewrites and checks only the unit's documents while the map spans the whole tree.
// Run: node plugins/stardust/skills/deploy/scripts/test/localize-links.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeHref, redirectPairs } from "../localize-links.mjs";
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
check("hrefs get the served URL: a folder index with its slash, a leaf without; .html and stray slashes fixed", () => {
  const map = new Map([["/en/news", "/en/news/"], ["/en/news/story", "/en/news/story"]]);
  const ctx = { map, hosts: ["example.com"] };
  assert.equal(localizeHref("https://www.example.com/en/news/index.html", ctx).href, "/en/news/");
  assert.equal(localizeHref("/en/news", ctx).href, "/en/news/");
  assert.equal(localizeHref("/en/news/story/?a=1#b", ctx).href, "/en/news/story?a=1#b");
  assert.equal(localizeHref("/en/news/", ctx).action, "already");
});
check("a content tree: links to a folder index get /x/, links to a leaf lose .html and the slash", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-")); const c = join(root, "content", "en", "news"); mkdirSync(c, { recursive: true });
  writeFileSync(join(c, "index.html"), '<a href="https://example.com/en/news/story.html">s</a>');
  writeFileSync(join(c, "story.html"), '<a href="/en/news">n</a> <a href="https://www.example.com/en/news/">n2</a>');
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", join(root, "content")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), '<a href="/en/news/story">s</a>');
  assert.equal(readFileSync(join(c, "story.html"), "utf8"), '<a href="/en/news/">n</a> <a href="/en/news/">n2</a>');
  rmSync(root, { recursive: true });
});
check("--help prints usage", () => { const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--help"], { encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout + r.stderr, /localize-links/); });
check("a missing --redirects file is a note: links still localized, --check as without it, --json redirectsFound false; a directory stays exit 1", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-m-")); const c = join(root, "content", "en"); mkdirSync(c, { recursive: true });
  const page = '<a href="https://example.com/en/b.html">b</a>';
  writeFileSync(join(c, "a.html"), page); writeFileSync(join(c, "b.html"), "");
  const missing = join(root, "redirects.tsv");
  const run = (...extra) => spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", join(root, "content"), ...extra], { encoding: "utf8" });
  const note = `localize-links: note: --redirects ${missing} not found — no redirect pairs read (seed-redirects.mjs writes it when the spec knowledge exists); continuing with the content tree only`;
  const checkWithout = run("--check"); const checkMissing = run("--check", "--redirects", missing);
  assert.equal(checkWithout.status, 2, checkWithout.stderr);
  assert.equal(checkMissing.status, checkWithout.status); assert.equal(checkMissing.stdout, checkWithout.stdout); assert.equal(checkMissing.stderr.trim(), note);
  assert.equal(readFileSync(join(c, "a.html"), "utf8"), page);
  const json = run("--json", "--dry-run", "--redirects", missing);
  assert.equal(json.status, 0, json.stderr); assert.equal(JSON.parse(json.stdout).redirectsFound, false);
  assert.equal(JSON.parse(run("--json", "--dry-run").stdout).redirectsFound, null);
  const r = run("--redirects", missing);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr.trim(), note);
  assert.equal(readFileSync(join(c, "a.html"), "utf8"), '<a href="/en/b">b</a>');
  writeFileSync(missing, "/en/old\t/en/b\n");
  assert.equal(JSON.parse(run("--json", "--dry-run", "--redirects", missing).stdout).redirectsFound, true);
  const dir = run("--redirects", join(root, "content"));
  assert.equal(dir.status, 1); assert.match(dir.stderr, /--redirects .* cannot be read/);
  rmSync(root, { recursive: true });
});

// --unit: two units' documents in one content tree. Unit a owns /en/a1 and the folder index /en/a/ (a DA path in its
// .paths), unit b owns /en/b1. Every document carries a localizable source-host link.
const A1 = '<a href="https://example.com/en/b1.html">b1</a>';
const AIDX = '<a href="https://www.example.com/en/a1">a1</a>';
const B1 = '<a href="https://example.com/en/a/index.html">a</a>';
function unitTree(aPaths = "# unit a\n/en/a1\n\n/en/a/index\n") {
  const root = mkdtempSync(join(tmpdir(), "localize-u-")); const en = join(root, "content", "en"); const units = join(root, "stardust", "rollout", "units");
  mkdirSync(join(en, "a"), { recursive: true }); mkdirSync(units, { recursive: true });
  writeFileSync(join(en, "a1.html"), A1); writeFileSync(join(en, "a", "index.html"), AIDX); writeFileSync(join(en, "b1.html"), B1);
  writeFileSync(join(units, "a.paths"), aPaths); writeFileSync(join(units, "b.paths"), "/en/b1\n");
  // run from the project root, so the default --units-dir stardust/rollout/units resolves
  const run = (...extra) => spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", "content", ...extra], { encoding: "utf8", cwd: root });
  const read = (rel) => readFileSync(join(en, rel), "utf8");
  return { root, run, read };
}
check("--unit a rewrites only a's documents (b's bytes unchanged) while a's links to b's pages localize; --json names the unit", () => {
  const { root, run, read } = unitTree();
  const json = run("--unit", "a", "--json", "--dry-run");
  assert.equal(json.status, 0, json.stderr);
  const j = JSON.parse(json.stdout);
  assert.deepEqual([j.unit, j.unitPaths, j.unitDocuments, j.unitMissing, j.filesChanged, j.localized, j.pages], ["a", 2, 2, [], 2, 2, 3]);
  assert.deepEqual(Object.keys(j.perFile), ["/en/a/index.html", "/en/a1.html"]);
  const r = run("--unit", "a");
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  assert.match(r.stdout, /^unit a: 2\/2 documents$/m);
  assert.match(r.stdout, /localized 2 source-host link\(s\) \+ normalized 0 internal href\(s\) across 2 file\(s\)/);
  assert.equal(read("a1.html"), '<a href="/en/b1">b1</a>');
  assert.equal(read("a/index.html"), '<a href="/en/a1">a1</a>');
  assert.equal(read("b1.html"), B1);
  rmSync(root, { recursive: true });
});
check("--check --unit counts and fails only on the unit's documents", () => {
  const { root, run, read } = unitTree();
  const before = run("--check", "--unit", "a");
  assert.equal(before.status, 2, before.stderr); assert.match(before.stdout, /CHECK FAIL — 2 link\(s\) still localizable/);
  assert.equal(run("--unit", "a").status, 0);
  const after = run("--check", "--unit", "a");
  assert.equal(after.status, 0, after.stdout); assert.match(after.stdout, /CHECK PASS — 0 link\(s\)/);
  const whole = run("--check");
  assert.equal(whole.status, 2); assert.match(whole.stdout, /CHECK FAIL — 1 link\(s\)/);
  assert.equal(run("--check", "--unit", "b").status, 2);
  assert.equal(read("b1.html"), B1);
  rmSync(root, { recursive: true });
});
check("--unit: a missing .paths is exit 1 with one line; a bad name, a missing value and --units-dir without --unit are usage (exit 1)", () => {
  const { root, run, read } = unitTree();
  const r = run("--unit", "c");
  assert.equal(r.status, 1); assert.equal(r.stdout, "");
  assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr); assert.match(r.stderr, /unit c: no stardust[/\\]rollout[/\\]units[/\\]c\.paths/);
  for (const args of [["--unit", "../a"], ["--unit", "a/b"], ["--unit"], ["--unit", "--check"], ["--units-dir", "stardust/rollout/units"]]) {
    const u = run(...args);
    assert.equal(u.status, 1, `${args.join(" ")}: ${u.stderr}`); assert.equal(u.stdout, "");
  }
  assert.equal(read("a1.html"), A1); assert.equal(read("b1.html"), B1);
  rmSync(root, { recursive: true });
});
check("--unit: a path without a document is one note each; --units-dir reads another directory", () => {
  const { root, run, read } = unitTree("/en/a1\n/en/gone\n/en/also-gone.html\n");
  mkdirSync(join(root, "elsewhere")); writeFileSync(join(root, "elsewhere", "a.paths"), "/en/a1\n");
  const json = run("--unit", "a", "--json", "--dry-run");
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(json.stderr.trim().split("\n"), [
    "localize-links: note: unit a: /en/gone has no document under content",
    "localize-links: note: unit a: /en/also-gone has no document under content",
  ]);
  const j = JSON.parse(json.stdout);
  assert.deepEqual([j.unitPaths, j.unitDocuments, j.unitMissing], [3, 1, ["/en/gone", "/en/also-gone"]]);
  const r = run("--unit", "a");
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^unit a: 1\/3 documents$/m);
  assert.equal(read("a1.html"), '<a href="/en/b1">b1</a>'); assert.equal(read("a/index.html"), AIDX); assert.equal(read("b1.html"), B1);
  const other = run("--unit", "a", "--units-dir", "elsewhere", "--json", "--dry-run");
  assert.equal(other.status, 0, other.stderr); assert.equal(JSON.parse(other.stdout).unitPaths, 1);
  rmSync(root, { recursive: true });
});
check("--unit: zero documents matched is exit 1 with one line, nothing written", () => {
  const { root, run, read } = unitTree("/en/x\n/en/y\n");
  const r = run("--unit", "a");
  assert.equal(r.status, 1); assert.equal(r.stdout, "");
  assert.equal(r.stderr.trim(), "localize-links: unit a: none of its 2 path(s) has a document under content");
  assert.equal(read("a1.html"), A1); assert.equal(read("a/index.html"), AIDX); assert.equal(read("b1.html"), B1);
  rmSync(root, { recursive: true });
});
check("without --unit the whole tree is rewritten and --json carries no unit keys", () => {
  const { root, run, read } = unitTree();
  const j = JSON.parse(run("--json", "--dry-run").stdout);
  assert.equal(j.filesChanged, 3); assert.equal("unit" in j || "unitPaths" in j || "unitMissing" in j, false);
  const r = run();
  assert.equal(r.status, 0, r.stderr); assert.doesNotMatch(r.stdout, /^unit /m);
  assert.equal(read("a1.html"), '<a href="/en/b1">b1</a>'); assert.equal(read("a/index.html"), '<a href="/en/a1">a1</a>'); assert.equal(read("b1.html"), '<a href="/en/a/">a</a>');
  rmSync(root, { recursive: true });
});
process.exit(failed ? 1 : 0);
