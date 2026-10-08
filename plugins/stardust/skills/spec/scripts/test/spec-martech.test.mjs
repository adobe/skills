#!/usr/bin/env node
// skills/spec/scripts/test/spec-martech.test.mjs — tag-manager container parsing: extensions, rules with page paths and selectors, data elements with data-layer paths and DOM selectors; the standalone --urls run.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-martech.test.mjs
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
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
import { parseLaunch } from "../spec-martech.mjs";
const js = `window._satellite.container={buildInfo:{minified:!0,buildDate:"2026-01-01T00:00:00Z"},dataElements:{"Page: Type":{modulePath:"ext-acdl/src/lib/dataElements/datalayerComputedState.js",settings:{path:"web.page.type"}},promoTitle:{defaultValue:"",modulePath:"core/src/lib/dataElements/customCode.js",settings:{source:function(){return $(".promo h2").text()}}}},extensions:{core:{displayName:"Core",hostedLibFilesBaseUrl:"x"}},rules:[{id:"RL1",name:"Event: Ads (BU) - page | Page View",events:[{modulePath:"core/src/lib/events/windowLoaded.js",settings:{}}],conditions:[{modulePath:"core/src/lib/conditions/path.js",settings:{paths:[{value:"/en/a.html"}]}}],actions:[{modulePath:"core/src/lib/actions/customCode.js",settings:{source:"https://assets.adobedtm.com/x/RC1-source.min.js"}}]},{id:"RL2",name:"Click",events:[{modulePath:"core/src/lib/events/click.js",settings:{elementSelector:".cta a"}}]}]};`;
check("parse", () => { const l = parseLaunch(js); assert.deepEqual(l.extensions, ["Core"]); assert.equal(l.rules.length, 2); assert.deepEqual(l.rules[0].paths, ["/en/a.html"]); assert.deepEqual(l.rules[0].customCode, ["https://assets.adobedtm.com/x/RC1-source.min.js"]); assert.deepEqual(l.rules[1].selectors, [".cta a"]); const de = Object.fromEntries(l.dataElements.map((d) => [d.name, d])); assert.equal(de["Page: Type"].source, "web.page.type"); assert.deepEqual(de.promoTitle.selectors, [".promo h2"]); });
helpCheck("spec-martech.mjs");

const page = '<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script><script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)}</script></head><body><main>x</main></body></html>';
const server = createServer((req, res) => { res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "text/html" }); res.end(page); });
await new Promise((r) => { server.listen(0, "127.0.0.1", r); });
const base = `http://127.0.0.1:${server.address().port}`;
const cwd = mkdtempSync(join(tmpdir(), "spec-martech-"));
const run = await new Promise((r) => { execFile(process.execPath, ["--no-warnings", join(HERE, "..", "spec-martech.mjs"), "--urls", `${base}/,${base}/about,${base}/missing`, "--out", "out"], { cwd }, (e, stdout, stderr) => r({ code: e ? e.code : 0, stderr })); });
server.close();
check("--urls runs without a spec config and reads each page's server HTML", () => {
  assert.equal(run.code, 0, run.stderr);
  const v = JSON.parse(readFileSync(join(cwd, "out", "vendors.json"), "utf8"));
  assert.equal(v.pages, 2, "a page that fails to load is skipped");
  const gtm = v.vendors.find((x) => x.host === "www.googletagmanager.com");
  assert.equal(gtm.pages, 2); assert.match(gtm.role, /tag manager/);
  assert.ok(v.inline.dataLayer && v.inline["gtag("]);
  assert.deepEqual(readdirSync(join(cwd, "out")).sort(), ["headers.json", "vendors.json"], "no Launch or OneTrust on the page, nothing fetched for them");
});
rmSync(cwd, { recursive: true });
process.exit(failed ? 1 : 0);
