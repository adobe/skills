#!/usr/bin/env node
// skills/spec/scripts/test/spec-rum.test.mjs — human views exclude bots and un-activated prerenders; aggregation by path, 404 referrers, consent, scope filter.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-rum.test.mjs
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
import { aggregate, isHumanView } from "../spec-rum.mjs";
check("isHumanView", () => { assert.equal(isHumanView({ userAgent: "bot:crawler" }), false); assert.equal(isHumanView({ userAgent: "desktop", events: [{ checkpoint: "prerender" }] }), false); assert.equal(isHumanView({ userAgent: "desktop", events: [{ checkpoint: "prerender" }, { checkpoint: "navigate", target: "prerendered" }] }), true); });
check("aggregate", () => { const b = [{ url: "https://example.com/en/a.html", weight: 100, userAgent: "mobile", events: [{ checkpoint: "consent", source: "cmp", target: "show" }] }, { url: "https://example.com/en/gone.html", weight: 100, userAgent: "desktop", events: [{ checkpoint: "404", source: "https://ref.example.org/" }] }, { url: "https://example.com/fr/x.html", weight: 100, userAgent: "desktop" }, { url: "https://example.com/en/a.html", weight: 100, userAgent: "bot" }]; const a = aggregate(b, "example.com", "/en/"); assert.equal(a.pages["/en/a.html"].views, 100); assert.equal(a.notFound["/en/gone.html"].referrers["https://ref.example.org/"], 100); assert.equal(a.human, 3); assert.equal(a.consent[0][0], "scope cmp show"); });
helpCheck("spec-rum.mjs");
process.exit(failed ? 1 : 0);
