#!/usr/bin/env node
// skills/spec/scripts/test/spec-capture.test.mjs — union box of grid-row members.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-capture.test.mjs
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
import { unionBox } from "../spec-capture.mjs";
check("union", () => assert.deepEqual(unionBox([{ x: 10, y: 20, w: 100, h: 50 }, null, { x: 120, y: 10, w: 30, h: 100 }]), { x: 10, y: 10, w: 140, h: 100 }));
check("empty", () => assert.equal(unionBox([null]), null));
helpCheck("spec-capture.mjs");
process.exit(failed ? 1 : 0);
