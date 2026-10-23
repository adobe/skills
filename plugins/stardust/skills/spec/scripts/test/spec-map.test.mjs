#!/usr/bin/env node
// skills/spec/scripts/test/spec-map.test.mjs — the mapping engine: direct rules, empty handling, whenKids, layout, sections, nesting, carousels, row heuristics, default-content merging.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-map.test.mjs
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
import { mapPage, ratioLabel } from "../spec-map.mjs";
check("ratioLabel", () => { assert.equal(ratioLabel({ widths: [6, 6] }), "equal"); assert.equal(ratioLabel({ widths: [4, 8] }), "narrow-wide"); assert.equal(ratioLabel({ widths: [9, 3] }), "wide-narrow"); assert.equal(ratioLabel({ c: "colctrl:cols2" }), "cols2"); });
const R = { direct: { text: { kind: "default", block: "text" }, img: { kind: "default", block: "image" }, form: { kind: "block", block: "form" }, tiles: { kind: "block", block: "promo", whenKids: true }, ad: { kind: "dynamic", block: "ad" }, gap: { kind: "default", block: "separator", keepEmpty: true } }, layout: ["box"], sections: { box: { block: "section-style", modsMatch: "^bg-" } }, nesting: { tabs: "tabs" }, carousels: { car: { single: { block: "hero", variant: "slide" }, multi: { block: "carousel" } } }, rows: { cards: "cards", columns: "columns", form: ["form"] } };
const T = (c, extra = {}) => ({ c, p: "0", chars: 5, imgs: 0, videos: 0, forms: 0, links: 0, ...extra });
check("default runs merge; empty text dropped; keepEmpty kept", () => { const b = mapPage([T("text"), T("text", { chars: 0 }), T("gap", { chars: 0 }), T("text")], R); assert.equal(b.length, 1); assert.equal(b[0].block, "default-content"); assert.equal(b[0].variant, "text+separator"); });
check("styled wrapper → section + children; plain wrapper flattened", () => { const b = mapPage([T("box", { mods: ["bg-dark"], kids: [T("form")] }), T("box", { mods: [], kids: [T("form")] })], R); assert.deepEqual(b.map((x) => x.block), ["section-style", "form", "form"]); assert.equal(b[1].section, "bg-dark"); });
check("whenKids: empty wrapper dropped", () => assert.equal(mapPage([T("tiles", { chars: 0, kids: [] })], R).length, 0));
check("nesting + carousels", () => { const b = mapPage([T("tabs", { kids: [T("ad")] }), T("car", { slides: 1 }), T("car", { slides: 3 })], R); assert.deepEqual(b.map((x) => `${x.block}:${x.variant ?? ""}`), ["tabs:with-nested-blocks", "ad:", "hero:slide", "carousel:"]); assert.equal(b[1].nested_in, "tabs"); });
check("rows: image|text → columns; 3 media cols → cards; form wins with aside", () => { const row = (cols, w) => ({ c: "row", p: "1", ncols: cols.length, widths: w, cols, chars: 0, imgs: 0, videos: 0, forms: 0, links: 0 }); const b = mapPage([row([[T("img", { imgs: 1, chars: 0 })], [T("text")]], [6, 6]), row([[T("img", { imgs: 1 }), T("text")], [T("img", { imgs: 1 }), T("text")], [T("img", { imgs: 1 }), T("text")]], [4, 4, 4]), row([[T("form")], [T("text")]], [8, 4])], R); assert.deepEqual(b.map((x) => `${x.block}:${x.variant}`), ["columns:image-text equal", "cards:3-up", "form:with-aside"]); });
check("unmapped components are reported", () => assert.equal(mapPage([T("mystery")], R)[0].kind, "unmapped"));
helpCheck("spec-map.mjs");
process.exit(failed ? 1 : 0);
