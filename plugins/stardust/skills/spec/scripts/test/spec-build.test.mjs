#!/usr/bin/env node
// skills/spec/scripts/test/spec-build.test.mjs — EDS path normalisation, traffic bands, computed findings.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-build.test.mjs
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
import { band, edsPath, fillFinding } from "../spec-build.mjs";
check("edsPath", () => { assert.equal(edsPath("/en/About_Us/Team--Page.html"), "/en/about-us/team-page"); assert.equal(edsPath("/en/index.html"), "/en/"); assert.equal(edsPath("/en/a/"), "/en/a/"); });
check("band", () => { assert.equal(band(0), "none"); assert.equal(band(500), "low"); assert.equal(band(5000), "medium"); assert.equal(band(50000), "high"); });
check("fillFinding replaces SQL with values", () => assert.equal(fillFinding("<b>{{SELECT 1}}</b> of {{SELECT 2}}", (s) => (s === "SELECT 1" ? 1234 : "x")), "<b>1,234</b> of x"));
helpCheck("spec-build.mjs");
process.exit(failed ? 1 : 0);
