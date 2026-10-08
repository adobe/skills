#!/usr/bin/env node
// skills/spec/scripts/test/spec-fetch.test.mjs — template rules read from raw HTML: body attribute, body class with a capture group, meta tag.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-fetch.test.mjs
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
import { readTemplate } from "../spec-fetch.mjs";
const html = `<html><head><title> Page  One </title><meta name="pagetype" content="article"></head><body class="x editable-landing y" data-template="product">`;
check("bodyAttr", () => assert.equal(readTemplate(html, { bodyAttr: "data-template" }).template, "product"));
check("bodyClass with capture group", () => assert.equal(readTemplate(html, { bodyClass: "^editable-(.+)$" }).template, "landing"));
check("meta", () => assert.equal(readTemplate(html, { meta: "pagetype" }).template, "article"));
check("title trimmed, bodyClass kept", () => { const r = readTemplate(html, {}); assert.equal(r.title, "Page One"); assert.match(r.bodyClass, /editable-landing/); });
helpCheck("spec-fetch.mjs");
process.exit(failed ? 1 : 0);
