#!/usr/bin/env node
// skills/spec/scripts/test/spec-sheet.test.mjs — component and row-shape matching for contact sheets.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-sheet.test.mjs
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
import { matchesWant } from "../spec-sheet.mjs";
check("component", () => assert.equal(matchesWant({ c: "text" }, "text"), true));
check("row shape", () => { const n = { c: "row", ncols: 2, cols: [[{ c: "image" }], [{ c: "text" }]] }; assert.equal(matchesWant(n, "row/2:image+text"), true); assert.equal(matchesWant(n, "row/3:image+text"), false); });
helpCheck("spec-sheet.mjs");
process.exit(failed ? 1 : 0);
