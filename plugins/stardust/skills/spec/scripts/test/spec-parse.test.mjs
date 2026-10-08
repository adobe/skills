#!/usr/bin/env node
// skills/spec/scripts/test/spec-parse.test.mjs — both parser profiles on fixture HTML: component roots, grid rows from column widths, colctrl columns, lazy images, page signals; the HTML reader (void, raw, implied end tags, template).
// Run: node plugins/stardust/skills/spec/scripts/test/spec-parse.test.mjs
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
import { parseHTML, query, textLen, templateOf } from "../lib.mjs";
import { PROFILES, groupRows, topLevel, pageSignals } from "../spec-parse.mjs";
const core = PROFILES["aem-core"];
check("reader: void, raw text, implied <p>, template content skipped", () => { const d = parseHTML(`<div id="m"><p>one<p>two<img src="a.jpg"><script>var x="<div>";</script><template><b>hidden</b></template></div>`); const m = query(d, "#m"); assert.equal(textLen(m), 7); assert.equal(m.children.filter((c) => c.tag === "p").length, 2); });
check("groupRows: 6+6 → one row; 12 alone; 4+4+4 → row", () => { const it = (w) => ({ w }); const g = groupRows([it(6), it(6), it(12), it(4), it(4), it(4)], (x) => x.w, () => false); assert.equal(g.length, 3); assert.equal(g[0].row.length, 2); assert.equal(g[2].row.length, 3); });
check("aem-core tree: container > row of two, lazy image counted", () => { const d = parseHTML(`<main><div class="aem-Grid"><div class="container responsivegrid aem-GridColumn aem-GridColumn--default--12"><div class="aem-Grid"><div class="image aem-GridColumn aem-GridColumn--default--6"><div data-cmp-src="/x.jpg"></div></div><div class="text aem-GridColumn aem-GridColumn--default--6"><p>Hello</p></div></div></div></div></main>`); const t = topLevel(query(d, "main"), core); assert.equal(t[0].c, "container"); assert.equal(t[0].kids[0].c, "row"); assert.deepEqual(t[0].kids[0].cols.map((c) => c[0].c), ["image", "text"]); assert.equal(t[0].kids[0].cols[0][0].imgs, 1); assert.equal(t[0].kids[0].cols[1][0].p, "0.k0.c1.0"); });
check("signals: scripts, consent domain script, hreflang, json-ld", () => { const h = `<html lang="en"><head><link rel="alternate" hreflang="de" href="/de"><script src="https://cdn.vendor.com/a.js" data-domain-script="1234"></script><script type="application/ld+json">{"@type":"Organization"}</script></head><body data-x="1"><form action="/s?q=1"></form></body></html>`; const s = pageSignals(parseHTML(h), h, "https://example.com"); assert.deepEqual(s.scriptHosts, ["cdn.vendor.com"]); assert.deepEqual(s.otDomainScripts, ["1234"]); assert.deepEqual(s.hreflang, ["de"]); assert.deepEqual(s.jsonld, ["Organization"]); assert.deepEqual(s.forms, ["/s"]); assert.equal(s.bodyData["data-x"], "1"); });
check("templateOf appends path segments when configured", () => { const cfg = { scopePath: "/en/", template: { pathSegments: 2 } }; assert.equal(templateOf({ template: "base", url: "https://example.com/en/home/news/a.html" }, cfg), "base · home/news"); assert.equal(templateOf({ template: "base", url: "https://example.com/en/a.html" }, { scopePath: "/en/" }), "base"); });
helpCheck("spec-parse.mjs");
process.exit(failed ? 1 : 0);
