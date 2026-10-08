#!/usr/bin/env node
// skills/spec/scripts/test/spec-variants.test.mjs — Jaccard distance and average-linkage clustering of block sets weighted by pages.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-variants.test.mjs
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
import { cluster, jaccard } from "../spec-variants.mjs";
check("jaccard", () => { assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 0); assert.equal(jaccard(new Set(["a"]), new Set(["b"])), 1); assert.equal(jaccard(new Set(), new Set()), 0); });
check("cluster at 0.5", () => { const s = new Map([["a|b", { set: new Set(["a", "b"]), pages: ["1", "2"] }], ["a|b|c", { set: new Set(["a", "b", "c"]), pages: ["3"] }], ["x", { set: new Set(["x"]), pages: ["4"] }]]); const c = cluster(s, 0.5).map((k) => k.sort().join(",")).sort(); assert.deepEqual(c, ["a|b,a|b|c", "x"]); });
helpCheck("spec-variants.mjs");
process.exit(failed ? 1 : 0);
