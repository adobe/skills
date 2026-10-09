#!/usr/bin/env node
// skills/rollout/scripts/test/seed-redirects.test.mjs — knowledge redirects into redirects.tsv: migration rows, legacy rows pointed at the target page's delivered URL, external / not-a-page / loop skipped, existing rows win; the CLI appends and is idempotent.
// Run: node plugins/stardust/skills/rollout/scripts/test/seed-redirects.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedRows } from "../seed-redirects.mjs";
import { pathKey } from "../../../deploy/scripts/eds-path.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };
const O = "https://example.com";
const urls = [
  { url: `${O}/en/a.html`, final_url: `${O}/en/a.html`, outcome: "page", eds_path: "/en/a" },
  { url: `${O}/en/news/index.html`, final_url: `${O}/en/news/index.html`, outcome: "page", eds_path: "/en/news/" },
];
const redirects = [
  { kind: "migration", src: "/en/a.html", target: "/en/a" },
  { kind: "migration", src: "/en/news/index.html", target: "/en/news/" },
  { kind: "legacy", src: `${O}/en/old-news`, target: `${O}/en/news/index.html`, external: 0 },
  { kind: "legacy", src: `${O}/en/shop`, target: "https://shop.example.org/", external: 1 },
  { kind: "legacy", src: `${O}/en/gone`, target: `${O}/en/elsewhere.html`, external: 0 },
  { kind: "legacy", src: `${O}/en/loop`, target: null, external: 0 },
];
check("migration rows, legacy to the target's delivered URL, skips counted", () => {
  const { rows, counts } = seedRows(redirects, urls, [], { pathKey });
  assert.deepEqual(rows, [["/en/a.html", "/en/a"], ["/en/news/index.html", "/en/news/"], ["/en/old-news", "/en/news/"]]);
  assert.deepEqual(counts, { migration: 2, legacy: 1, present: 0, external: 1, "not-a-page": 1, loop: 1 });
});
check("a source already in redirects.tsv wins (by lookup key)", () => {
  const { rows, counts } = seedRows(redirects, urls, ["/en/A"], { pathKey });
  assert.equal(rows.some(([s]) => s === "/en/a.html"), false); assert.equal(counts.present, 1);
});
check("CLI appends under one comment, keeps existing lines, and a second run adds nothing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "seed-redirects-"));
  const k = join(cwd, "stardust", "spec", "knowledge"); mkdirSync(k, { recursive: true });
  writeFileSync(join(k, "redirects.jsonl"), redirects.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(k, "urls.jsonl"), urls.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(cwd, "stardust", "redirects.tsv"), "# path-safety\n/en/B_c\t/en/b-c\n");
  const run = () => spawnSync(process.execPath, [join(HERE, "..", "seed-redirects.mjs")], { cwd, encoding: "utf8" });
  const r1 = run(); assert.equal(r1.status, 0, r1.stderr);
  const tsv = readFileSync(join(cwd, "stardust", "redirects.tsv"), "utf8");
  assert.match(tsv, /^# path-safety\n\/en\/B_c\t\/en\/b-c\n# seeded from /); assert.match(tsv, /\/en\/old-news\t\/en\/news\/\n$/);
  const r2 = run(); assert.match(r2.stdout, /0 added/); assert.equal(readFileSync(join(cwd, "stardust", "redirects.tsv"), "utf8"), tsv);
  rmSync(cwd, { recursive: true });
});
check("--help prints usage; a missing knowledge folder exits 1", () => {
  const cwd = mkdtempSync(join(tmpdir(), "seed-redirects-help-"));
  const h = spawnSync(process.execPath, [join(HERE, "..", "seed-redirects.mjs"), "--help"], { cwd, encoding: "utf8" }); assert.equal(h.status, 0); assert.match(h.stdout, /seed-redirects\.mjs/);
  const m = spawnSync(process.execPath, [join(HERE, "..", "seed-redirects.mjs")], { cwd, encoding: "utf8" }); assert.equal(m.status, 1);
  rmSync(cwd, { recursive: true });
});
process.exit(failed ? 1 : 0);
