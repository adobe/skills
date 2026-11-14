#!/usr/bin/env node
// skills/spec/scripts/test/spec-profile.test.mjs — component profile: pages, instances, medians, parents, row shapes; duplicate final URLs counted once.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-profile.test.mjs
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
import { profile } from "../spec-profile.mjs";
check("profile", () => { const rows = [{ url: "a", final_url: "a", template: "t", comps: [{ c: "box", chars: 10, kids: [{ c: "text", chars: 4 }] }, { c: "row", ncols: 2, cols: [[{ c: "image", imgs: 1 }], [{ c: "text", chars: 6 }]] }] }, { url: "b", final_url: "a", template: "t", comps: [{ c: "box" }] }]; const p = profile(rows); const t = p.find((x) => x.component === "text"); assert.equal(t.pages, 1); assert.equal(t.instances, 2); assert.ok(p.find((x) => x.component === "row/2:image+text").shape); assert.equal(p.find((x) => x.component === "box").pages, 1); });
helpCheck("spec-profile.mjs");
process.exit(failed ? 1 : 0);
