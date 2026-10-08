#!/usr/bin/env node
// skills/spec/scripts/test/spec-knowledge.test.mjs — EDS paths, bands, outcomes, retired reach kinds, answers, the index yaml; a fixture run end to end: urls, blocks, reach, impact, findings, answers, bad links grouped by target, helix-query.yaml, a stable rerun.
// Run: node plugins/stardust/skills/spec/scripts/test/spec-knowledge.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { band, edsPath, indexYaml, latestAnswers, outcome, reachRule } from "../spec-knowledge.mjs";

check("edsPath", () => { assert.equal(edsPath("/en/About_Us/Team--Page.html"), "/en/about-us/team-page"); assert.equal(edsPath("/en/index.html"), "/en/"); assert.equal(edsPath("/en/a/"), "/en/a/"); });
check("band", () => { assert.equal(band(0), "none"); assert.equal(band(500), "low"); assert.equal(band(5000), "medium"); assert.equal(band(50000), "high"); });
check("outcome", () => { assert.equal(outcome({ status: 200 }), "page"); assert.equal(outcome({ status: 301, final_status: 404 }), "redirect-broken"); assert.equal(outcome({ error: "redirect loop" }), "loop"); assert.equal(outcome({ status: 410 }), "http-410"); });
check("reach: the rule format; sql:, url:, bvariant: are retired", () => { assert.deepEqual(reachRule("live sitemap block:hero"), ["live", "sitemap", "block:hero"]); assert.throws(() => reachRule("sql:SELECT 1"), /retired/); assert.throws(() => reachRule("url:/a"), /retired/); });
check("latestAnswers: the last answer per question wins", () => assert.deepEqual(latestAnswers([{ question: "Q1", answer: "a" }, { question: "Q1", answer: "b", by: "owner" }]), { Q1: { answer: "b", option: null, by: "owner", at: null } }));
check("indexYaml follows the dynamics skeleton", () => {
  const y = indexYaml({ name: "default", include: ["/en/**"], exclude: ["/nav"], properties: ["title", "image", "publishDate"] }, "/en/");
  assert.match(y, /target: \/en\/query-index\.json/); assert.match(y, /og:image"\]\n        value: match\(/); assert.match(y, /meta\[name="publishdate"\]/);
});

// a fixture project: three sitemap pages, one redirect into a 404, one discovered page
const root = mkdtempSync(join(tmpdir(), "spec-knowledge-"));
const W = (...p) => join(root, "stardust", ".work", "spec", ...p); const D = (...p) => join(root, "stardust", "spec", ...p);
const put = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v)); };
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n");
const O = "https://example.com";
put(D("spec.config.json"), { site: "Example", origin: O, scopePath: "/en/", template: { bodyAttr: "data-template" }, parser: { profile: "generic" } });
put(W("inventory", "urls.txt"), [`${O}/en/a.html`, `${O}/en/b.html`, `${O}/en/old.html`].join("\n"));
put(W("fetch", "fetch.jsonl"), jl([
  { url: `${O}/en/a.html`, status: 200, final_url: `${O}/en/a.html`, final_status: 200, title: "A", template: "page" },
  { url: `${O}/en/b.html`, status: 200, final_url: `${O}/en/b.html`, final_status: 200, title: "B", template: "page" },
  { url: `${O}/en/old.html`, status: 301, final_url: `${O}/en/gone.html`, final_status: 404, chain: [`${O}/en/gone.html`] },
]));
put(W("links", "pages.jsonl"), jl([{ url: `${O}/en/c.html`, status: 200, final_url: `${O}/en/c.html`, final_status: 200, title: "C", template: "page" }]));
put(W("parse", "components.jsonl"), jl([{ url: `${O}/en/a.html`, main_chars: 900, chrome: { header: true, footer: true } }, { url: `${O}/en/b.html`, main_chars: 10, chrome: {} }]));
put(W("parse", "signals.jsonl"), jl([
  { url: `${O}/en/a.html`, hreflang: [], scriptHosts: ["cdn.player.example"], iframeHosts: [], jsonld: [], meta: { description: "x" }, bodyData: {} },
  { url: `${O}/en/b.html`, hreflang: [], scriptHosts: [], iframeHosts: [], jsonld: [], meta: {}, bodyData: {} },
]));
put(W("parse", "links.jsonl"), jl([{ url: `${O}/en/a.html`, links: { [`${O}/en/old.html`]: "main" } }, { url: `${O}/en/b.html`, links: { [`${O}/en/old.html`]: "chrome" } }]));
put(W("map", "page-blocks.jsonl"), jl([
  { url: `${O}/en/a.html`, blocks: [{ kind: "block", block: "hero", variant: null, aem: ["banner"], path: "0", pos: 0 }, { kind: "block", block: "cards", variant: "3-up", aem: ["tiles"], path: "1", pos: 1 }] },
  { url: `${O}/en/b.html`, blocks: [] },
  { url: `${O}/en/c.html`, blocks: [{ kind: "block", block: "hero", variant: null, aem: ["banner"], path: "0", pos: 0 }] },
]));
put(W("map", "variants.json"), [{ template: "page", code: "page#1", pages: 2, core: ["hero"], optional: [], urls: [`${O}/en/a.html`, `${O}/en/b.html`], distinct_sets: 2, representative: `${O}/en/a.html` }]);
put(D("judgement", "catalog.json"), { blocks: { hero: { kind: "block", family: "hero", description: "Hero", aem: ["banner"], reference: "hero", verdict: "reuse" }, cards: { kind: "block", family: "grid", description: "Cards", aem: ["tiles"], reference: "cards", verdict: "new" }, header: { kind: "global", family: "other", description: "Header", verdict: "variant" }, footer: { kind: "global", family: "other", description: "Footer", verdict: "variant" } } });
put(D("judgement", "implementation.json"), {
  features: [{ id: "player", class: "V", name: "Player", reach: "live sitemap signal:script:*player*", decisions: ["Q-1"] }],
  open_questions: [{ id: "Q-1", area: "Media", owner: "stakeholder", question: "Keep the player?", options: ["yes", "no"], default: "yes", impact: "features[player].reach_pages" },
    { id: "Q-2", area: "Scope", owner: "stakeholder", question: "Empty pages?", default: "migrate", impact: "urls sitemap flag=empty" }],
  query_indexes: [{ name: "default", include: ["/en/**"], exclude: ["/nav"], properties: ["title"] }],
});
put(D("judgement", "findings.json"), [{ title: "Reuse.", text: "{{urls live sitemap !verdict:new}} of {{urls live sitemap}} live pages need no new block." }]);
put(D("judgement", "answers.json"), [{ question: "Q-2", answer: "retire them", by: "owner", at: "2026-10-08" }]);
const run = () => spawnSync(process.execPath, ["--no-warnings", join(HERE, "..", "spec-knowledge.mjs")], { cwd: root, encoding: "utf8" });
const r1 = run();
const K = (f) => readFileSync(D("knowledge", f), "utf8");
const KJ = (f) => JSON.parse(K(f)); const KL = (f) => K(f).split("\n").filter(Boolean).map((l) => JSON.parse(l));
check("fixture run exits 0", () => assert.equal(r1.status, 0, r1.stderr));
check("urls: sitemap rows, the discovered in-scope page, outcomes and flags", () => {
  const u = KL("urls.jsonl"); assert.deepEqual(u.map((x) => [x.path, x.in_sitemap, x.outcome]), [["/en/a.html", 1, "page"], ["/en/b.html", 1, "page"], ["/en/old.html", 1, "redirect-broken"], ["/en/c.html", 0, "page"]]);
  assert.equal(u[1].flag, "empty"); assert.equal(u[0].eds_path, "/en/a");
});
check("page blocks carry chrome globals around the page's blocks", () => assert.deepEqual(KL("page-blocks.jsonl")[0].blocks.map((b) => b.block), ["header", "hero", "cards", "footer"]));
check("blocks: counts on sitemap pages only, variants with verdicts", () => { const b = Object.fromEntries(KJ("blocks.json").map((x) => [x.name, x])); assert.equal(b.hero.url_count, 1); assert.equal(b.cards.variants[0].verdict, "new"); });
check("feature reach and question impact are computed", () => { assert.equal(KJ("features.json")[0].reach_pages, 1); assert.deepEqual(KJ("open-questions.json").map((q) => q.impact), [1, 1]); });
check("answers replace the default; the default stays recorded", () => { const q = KJ("open-questions.json")[1]; assert.equal(q.effective, "retire them"); assert.equal(q.default_assumption, "migrate"); assert.equal(KJ("open-questions.json")[0].effective, "yes"); });
check("findings: plain text with computed numbers", () => assert.deepEqual(KJ("findings.json"), [{ title: "Reuse.", text: "1 of 2 live pages need no new block.", numbers: [1, 2] }]));
check("redirects, broken, bad links grouped by target", () => {
  assert.equal(KL("redirects.jsonl").filter((x) => x.kind === "legacy").length, 1);
  assert.equal(KL("broken.jsonl")[0].note, "sitemap URL redirects into a dead page");
  assert.deepEqual(KL("bad-links.jsonl"), [{ to_url: `${O}/en/old.html`, main: [1], chrome: [2] }]);
});
check("helix-query.yaml drafted from the query indexes", () => assert.match(K("helix-query.yaml"), /^version: 1\nindices:\n {2}default:/));
check("no viewer concerns in the output", () => { const s = KJ("site.json"); assert.ok(!("scope_label" in s) && !("tour_steps" in s)); assert.ok(!readdirSync(D("knowledge")).some((f) => f.endsWith(".sqlite"))); });
check("a rerun writes the same files (apart from the build stamp)", () => {
  const snap = () => Object.fromEntries(readdirSync(D("knowledge")).map((f) => [f, K(f).replace(/"built_at": "[^"]+"/, "")]));
  const a = snap(); const r2 = run(); assert.equal(r2.status, 0); assert.deepEqual(snap(), a);
});
check("a rule that cannot be computed stops the stage and names it", () => {
  put(D("judgement", "findings.json"), [{ title: "x", text: "{{blocks[absent].url_count}}" }]);
  const r = run(); assert.equal(r.status, 1); assert.match(r.stderr, /blocks\[absent\]\.url_count/);
});
rmSync(root, { recursive: true });
helpCheck("spec-knowledge.mjs");
process.exit(failed ? 1 : 0);
