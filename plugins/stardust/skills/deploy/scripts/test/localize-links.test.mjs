#!/usr/bin/env node
// skills/deploy/scripts/test/localize-links.test.mjs — the redirects reader: TSV with comments, JSON array and map, the published DA sheet, JSON Lines with src/target; incomplete rows skipped.
// Run: node plugins/stardust/skills/deploy/scripts/test/localize-links.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
check("--receipt: the sha256 of the bytes READ and WRITTEN for each file the run rewrote, nothing else; one receipt per run; not with --check", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-rc-")); const c = join(root, "content"); mkdirSync(join(c, "visit"), { recursive: true });
  const home = '<a href="https://example.com/visit/">v</a>';
  writeFileSync(join(c, "index.html"), home); writeFileSync(join(c, "about.html"), '<p>no source link</p>'); writeFileSync(join(c, "visit", "index.html"), "<p>visit</p>");
  const L = (...a) => spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c, ...a], { encoding: "utf8" });
  const r = L("--receipt", join(root, "r1.json"));
  assert.equal(r.status, 0, r.stderr);
  const rc = JSON.parse(readFileSync(join(root, "r1.json"), "utf8"));
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  assert.deepEqual(Object.keys(rc.files), ["/index.html"], "only the file it rewrote — about.html untouched is not in it");
  assert.deepEqual(rc.files["/index.html"], { input: sha(home), output: sha('<a href="/visit/">v</a>') });
  assert.equal(rc.tool, "localize-links"); assert.match(rc.at, /^\d{4}-/);
  assert.equal(L("--receipt", join(root, "r1.json")).status, 1, "an existing receipt is never overwritten");
  assert.equal(L("--check", "--receipt", join(root, "r2.json")).status, 1);
  rmSync(root, { recursive: true });
});
check("--targets: only the listed documents are link targets — a source link to any other (a held draft) stays; every document is still read as a page", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-tg-")); const c = join(root, "content"); mkdirSync(c, { recursive: true });
  writeFileSync(join(c, "index.html"), '<a href="https://example.com/draft">d</a> <a href="https://example.com/about">a</a>');
  writeFileSync(join(c, "draft.html"), '<a href="https://example.com/about">a</a>'); writeFileSync(join(c, "about.html"), "<p>about</p>");
  writeFileSync(join(root, "targets.paths"), "/index.html\n/about.html\n");
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c, "--targets", join(root, "targets.paths")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), '<a href="https://example.com/draft">d</a> <a href="/about">a</a>');
  assert.equal(readFileSync(join(c, "draft.html"), "utf8"), '<a href="/about">a</a>', "its own links are still localized");
  rmSync(root, { recursive: true });
});
check("a file deploy never sends (`Draft.HTML`, `x.htm`) is no document: no link target, not rewritten — the deployer's rule (lib/documents.mjs)", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-case-")); const c = join(root, "content"); mkdirSync(c, { recursive: true });
  writeFileSync(join(c, "index.html"), '<a href="https://example.com/Draft">d</a> <a href="https://example.com/old">o</a>');
  writeFileSync(join(c, "Draft.HTML"), '<a href="https://example.com/">h</a>'); writeFileSync(join(c, "old.htm"), '<a href="https://example.com/">h</a>');
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), '<a href="https://example.com/Draft">d</a> <a href="https://example.com/old">o</a>');
  assert.equal(readFileSync(join(c, "Draft.HTML"), "utf8"), '<a href="https://example.com/">h</a>');
  rmSync(root, { recursive: true });
});
check("--receipt is written before any page: its folder is created; a receipt that cannot be written leaves every page as it was (exit 1)", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-rf-")); const c = join(root, "content"); mkdirSync(c, { recursive: true });
  const page = '<a href="https://example.com/about">a</a>';
  writeFileSync(join(c, "index.html"), page); writeFileSync(join(c, "about.html"), "<p>about</p>");
  writeFileSync(join(root, "not-a-dir"), "");
  const L = (rc) => spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c, "--receipt", rc], { encoding: "utf8" });
  const bad = L(join(root, "not-a-dir", "r.json"));
  assert.equal(bad.status, 1); assert.match(bad.stderr, /no page written/);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), page, "unchanged");
  const ok = L(join(root, "pass", "receipts", "r.json"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, "pass", "receipts", "r.json"), "utf8")).files), ["/index.html"]);
  rmSync(root, { recursive: true });
});
check("an entry whose name starts with `.` (`.drafts/`) is no document, as on main: not a link target, not rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-dot-")); const c = join(root, "content"); mkdirSync(join(c, ".drafts"), { recursive: true });
  writeFileSync(join(c, "index.html"), '<a href="https://example.com/drafts/offer">o</a>');
  writeFileSync(join(c, ".drafts", "offer.html"), '<a href="https://example.com/">h</a>');
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), '<a href="https://example.com/drafts/offer">o</a>');
  assert.equal(readFileSync(join(c, ".drafts", "offer.html"), "utf8"), '<a href="https://example.com/">h</a>');
  rmSync(root, { recursive: true });
});
check("--rewrite: only the listed documents are rewritten; another one with a source link is left exactly as it is (and stays out of the receipt)", () => {
  const root = mkdtempSync(join(tmpdir(), "localize-rw-")); const c = join(root, "content"); mkdirSync(c, { recursive: true });
  const kept = '<a href="https://example.com/about">a</a>';
  writeFileSync(join(c, "index.html"), kept); writeFileSync(join(c, "new.html"), kept); writeFileSync(join(c, "about.html"), "<p>about</p>");
  writeFileSync(join(root, "rewrite.paths"), "/new.html\n");
  const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--source-host", "example.com", "--content", c, "--rewrite", join(root, "rewrite.paths"), "--receipt", join(root, "r.json")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(c, "index.html"), "utf8"), kept, "not this run's to rewrite");
  assert.equal(readFileSync(join(c, "new.html"), "utf8"), '<a href="/about">a</a>');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(root, "r.json"), "utf8")).files), ["/new.html"]);
  rmSync(root, { recursive: true });
});
check("--help prints usage", () => { const r = spawnSync(process.execPath, [join(HERE, "..", "localize-links.mjs"), "--help"], { encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout + r.stderr, /localize-links/); });
process.exit(failed ? 1 : 0);
