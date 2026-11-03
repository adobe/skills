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
import { consentModeOf, parseLaunch, tagLibraries } from "../spec-martech.mjs";
const js = `window._satellite.container={buildInfo:{minified:!0,buildDate:"2026-01-01T00:00:00Z"},dataElements:{"Page: Type":{modulePath:"ext-acdl/src/lib/dataElements/datalayerComputedState.js",settings:{path:"web.page.type"}},promoTitle:{defaultValue:"",modulePath:"core/src/lib/dataElements/customCode.js",settings:{source:function(){return $(".promo h2").text()}}}},extensions:{core:{displayName:"Core",hostedLibFilesBaseUrl:"x"}},rules:[{id:"RL1",name:"Event: Ads (BU) - page | Page View",events:[{modulePath:"core/src/lib/events/windowLoaded.js",settings:{}}],conditions:[{modulePath:"core/src/lib/conditions/path.js",settings:{paths:[{value:"/en/a.html"}]}}],actions:[{modulePath:"core/src/lib/actions/customCode.js",settings:{source:"https://assets.adobedtm.com/x/RC1-source.min.js"}}]},{id:"RL2",name:"Click",events:[{modulePath:"core/src/lib/events/click.js",settings:{elementSelector:".cta a"}}]}]};`;
check("parse", () => { const l = parseLaunch(js); assert.deepEqual(l.extensions, ["Core"]); assert.equal(l.rules.length, 2); assert.deepEqual(l.rules[0].paths, ["/en/a.html"]); assert.deepEqual(l.rules[0].customCode, ["https://assets.adobedtm.com/x/RC1-source.min.js"]); assert.deepEqual(l.rules[1].selectors, [".cta a"]); const de = Object.fromEntries(l.dataElements.map((d) => [d.name, d])); assert.equal(de["Page: Type"].source, "web.page.type"); assert.deepEqual(de.promoTitle.selectors, [".promo h2"]); });
check("parse: Adobe Target — the at.js extension; Web SDK rules that render decisions, with prehiding", () => {
  assert.equal(parseLaunch(js).target, null);
  const at = js.replace('extensions:{core:', 'extensions:{"adobe-target-v2":{displayName:"Adobe Target v2",hostedLibFilesBaseUrl:"x"},core:');
  assert.deepEqual(parseLaunch(at).target, { atjs: "adobe-target-v2", renderRules: [], prehiding: false });
  const ws = js.replace('extensions:{core:', 'extensions:{"adobe-alloy":{displayName:"Adobe Experience Platform Web SDK",settings:{instances:[{name:"alloy",prehidingStyle:".hero{opacity:0}"}]}},core:')
    .replace('actions:[{modulePath:"core/src/lib/actions/customCode.js"', 'actions:[{modulePath:"adobe-alloy/dist/lib/actions/sendEvent/index.js",settings:{instanceName:"alloy",renderDecisions:!0}},{modulePath:"core/src/lib/actions/customCode.js"');
  assert.deepEqual(parseLaunch(ws).target, { atjs: null, renderRules: [{ id: "RL1", name: "Event: Ads (BU) - page | Page View" }], prehiding: true });
});
const DS = ["11111111-2222-4333-8444-555555555555", "66666666-7777-4888-9999-aaaaaaaaaaaa"];
const sdk = (settings) => `window._satellite.container={company:{orgId:"TEST@AdobeOrg"},dataElements:{"Prod Datastream":{modulePath:"core/src/lib/dataElements/customCode.js",settings:{source:function(){return location.host==="b.test"?"${DS[1]}":"${DS[0]}"}}}},extensions:{"adobe-alloy":{displayName:"Adobe Experience Platform Web SDK",hostedLibFilesBaseUrl:"x",settings:${settings},modules:{a:{script:function(){var c={PREINSTALLED:"preinstalled"};w.injectWrapOnBeforeEventSend({version:"2.34.2"})}}}}},rules:[{id:"RL3",name:"Cart add",events:[{modulePath:"gcoe-adobe-client-data-layer/src/lib/events/datalayerPushListener.js",settings:{}}]}]};`;
check("parse: the Web SDK extension — version, self-hosted support, instance, datastream ids through a data element", () => {
  const l = parseLaunch(sdk(`{instances:[{name:"alloy",edgeDomain:"metrics.example.test",edgeConfigId:"%Prod Datastream%",stagingEdgeConfigId:"${DS[1]}"}]}`));
  assert.equal(l.orgId, "TEST@AdobeOrg");
  assert.deepEqual(l.webSdk, { version: "2.34.2", selfHostable: true, library: "managed", instances: [{ name: "alloy", edgeDomain: "metrics.example.test", defaultConsent: null, datastream: { ref: "%Prod Datastream%", ids: [DS[1], DS[0]] }, stagingDatastream: { ref: DS[1], ids: [DS[1]] } }] });
  assert.deepEqual(l.rules[0].events, ["datalayerPushListener"]);
  assert.equal(parseLaunch(sdk(`{libraryCode:{type:"preinstalled"},instances:[{name:"alloy",defaultConsent:"pending",edgeConfigId:"${DS[0]}"}]}`)).webSdk.library, "preinstalled");
  assert.equal(parseLaunch(js).webSdk, null);
});
check("parse: each data-layer rule's push event — named, any push, or not named", () => {
  const ev = (settings) => `{modulePath:"adobe-client-data-layer/src/lib/events/dataLayerPush.js",settings:${settings}}`;
  const c = `window._satellite.container={rules:[{id:"RL1",name:"Click",events:[${ev('{specificEvent:"cmp:click",allEvents:!1}')}]},{id:"RL2",name:"Any",events:[${ev('{allEvents:!0}')}]},{id:"RL3",name:"Bare",events:[${ev('{}')}]},{id:"RL4",name:"ACDL",events:[${ev('{scope:"all",method:"specificEvent",eventKey:"reOrder"}')}]}]};`;
  assert.deepEqual(parseLaunch(c).rules.map((r) => r.pushEvents), [["cmp:click"], ["*"], [null], ["reOrder"]]);
});
check("tag libraries: GTM and gtag by container id, other tag managers by src, Launch left to its parser", () => {
  const role = { "tags.tiqcdn.com": "tag manager: Tealium", "nexus.ensighten.com": "tag manager: other", "assets.adobedtm.com": "tag manager: Adobe Launch", "www.googletagmanager.com": "tag manager: Google Tag Manager" };
  const vendorFor = (h) => (role[h] ? { role: role[h] } : null);
  const sigs = [{ tagIds: ["GTM-ABC123", "G-XYZ789"], scripts: ["https://www.googletagmanager.com/gtm.js", "//tags.tiqcdn.com/utag/acme/main/prod/utag.js", "https://assets.adobedtm.com/a/launch-1.min.js", "/local.js"] },
    { tagIds: ["GTM-ABC123"], scripts: ["https://nexus.ensighten.com/acme/Bootstrap.js"] }];
  assert.deepEqual(tagLibraries(sigs, vendorFor), [
    { vendor: "Google Tag Manager", url: "https://www.googletagmanager.com/gtm.js?id=GTM-ABC123", file: "www.googletagmanager.com-gtm-GTM-ABC123.js" },
    { vendor: "Google Tag Manager", url: "https://www.googletagmanager.com/gtag/js?id=G-XYZ789", file: "www.googletagmanager.com-js-G-XYZ789.js" },
    { vendor: "Tealium", url: "https://tags.tiqcdn.com/utag/acme/main/prod/utag.js", file: "tags.tiqcdn.com-utag.js" },
    { vendor: "other", url: "https://nexus.ensighten.com/acme/Bootstrap.js", file: "nexus.ensighten.com-Bootstrap.js" },
  ]);
});
check("Google Consent Mode: pages with an inline default, libraries that set one; null when unseen", () => {
  const tags = [{ file: "gtm-A.js", js: "x.setDefaultConsentState({ad_storage:'denied'})" }, { file: "utag.js", js: "nothing" }];
  assert.deepEqual(consentModeOf([{ consentMode: true }, { consentMode: false }], tags), { pages: 1, of: 2, libraries: ["tags/gtm-A.js"] });
  assert.equal(consentModeOf([{ consentMode: false }], [{ file: "utag.js", js: "nothing" }]), null);
});
helpCheck("spec-martech.mjs");

const page = '<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script><script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)}</script></head><body><main>x</main></body></html>';
const server = createServer((req, res) => { res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "text/html" }); res.end(page); });
await new Promise((r) => { server.listen(0, "127.0.0.1", r); });
const base = `http://127.0.0.1:${server.address().port}`;
const cwd = mkdtempSync(join(tmpdir(), "spec-martech-"));
const run = await new Promise((r) => { execFile(process.execPath, ["--no-warnings", join(HERE, "..", "spec-martech.mjs"), "--urls", `${base}/,${base}/about,${base}/missing`, "--out", "out", "--no-tag-libraries"], { cwd }, (e, stdout, stderr) => r({ code: e ? e.code : 0, stderr })); });
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
