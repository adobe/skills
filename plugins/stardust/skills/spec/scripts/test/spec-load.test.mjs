#!/usr/bin/env node
// skills/spec/scripts/test/spec-load.test.mjs — SQL dump replaces spec tables and keeps operator-owned tables (decisions, chat log, usage, saved views).
// Run: node plugins/stardust/skills/spec/scripts/test/spec-load.test.mjs
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
import { DatabaseSync } from "node:sqlite";
import { dumpSQL } from "../spec-load.mjs";
check("dump", () => { const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE url(id INTEGER, path TEXT); CREATE TABLE question_answer(id INTEGER); CREATE VIEW v AS SELECT * FROM url;"); db.prepare("INSERT INTO url VALUES (?, ?)").run(1, "it's"); const s = dumpSQL(db); assert.match(s, /DROP TABLE IF EXISTS url;/); assert.doesNotMatch(s, /DROP TABLE IF EXISTS question_answer/); assert.match(s, /CREATE TABLE IF NOT EXISTS question_answer/); assert.ok(s.includes("INSERT INTO url VALUES (1,'it''s');")); assert.match(s, /DROP VIEW IF EXISTS v;/); });
helpCheck("spec-load.mjs");
process.exit(failed ? 1 : 0);
