#!/usr/bin/env node
// skills/spec/scripts/test/spec-pick.test.mjs — example URLs per component, spread across templates, deduplicated by final URL.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-pick.test.mjs
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
import { componentExamples } from "../spec-pick.mjs";
check("two examples per component", () => { const rows = [{ url: "u1", final_url: "u1", template: "a", comps: [{ c: "x", kids: [{ c: "y" }] }] }, { url: "u2", final_url: "u2", template: "b", comps: [{ c: "x" }] }, { url: "u3", final_url: "u3", template: "a", comps: [{ c: "x" }] }, { url: "u4", final_url: "u1", template: "a", comps: [{ c: "z" }] }]; const r = componentExamples(rows, 2); assert.deepEqual(r.sort(), ["u1", "u2"]); });
helpCheck("spec-pick.mjs");
process.exit(failed ? 1 : 0);
