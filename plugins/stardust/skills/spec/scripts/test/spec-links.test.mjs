#!/usr/bin/env node
// skills/spec/scripts/test/spec-links.test.mjs — discovered same-origin links split into pages and assets; known pages and other origins skipped.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-links.test.mjs
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
import { splitLinks } from "../spec-links.mjs";
check("split", () => { const r = splitLinks([{ links: { "https://example.com/a.html": "main", "https://example.com/content/dam/x.pdf": "main", "https://example.com/known.html": "chrome", "https://other.example.org/z": "main" } }], "https://example.com", new Set(["https://example.com/known.html"])); assert.deepEqual(r.pages, ["https://example.com/a.html"]); assert.deepEqual(r.assets, ["https://example.com/content/dam/x.pdf"]); });
helpCheck("spec-links.mjs");
process.exit(failed ? 1 : 0);
