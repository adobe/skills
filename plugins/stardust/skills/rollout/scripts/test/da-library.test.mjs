#!/usr/bin/env node
// skills/rollout/scripts/test/da-library.test.mjs — the DA library (#159): authored blocks and their class variants lifted from DA bodies, block and template documents in the shape the DA library reads, sheets, and a config merge that only replaces the Blocks / Templates rows; the CLI --dry-run writes the files from coverage and touches no network.
// Run: node plugins/stardust/skills/rollout/scripts/test/da-library.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topDivs, blocksOf, collectBlocks, blockDoc, templateDoc, sheet, mergeLibraryConfig, templateName, docName } from "../da-library.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };

const meta = `<div class="metadata"><div><div>Title</div><div>Home of a brand</div></div><div><div>template</div><div>landing</div></div><div><div>og:type</div><div>website</div></div><div><div>JSON-LD</div><div>{"@type":"Organization"}</div></div></div>`;
const home = `<body><header></header><main>
<div>${meta}</div>
<div><h2>Intro</h2><div class="cards dark"><div><div><p>One</p></div></div><div><div>nested <div>inner</div></div></div></div><!-- <div class="ghost"></div> --></div>
<div><div class="hero"><div><div><h1>Hi</h1></div></div></div><div class="section-metadata"><div><div>style</div><div>dark</div></div></div></div>
</main><footer></footer></body>`;
const about = `<body><header></header><main><div><div class="cards"><div><div>Plain</div></div></div><div class="cards dark"><div><div>Second dark</div></div></div><div class="stray"><div><div>x</div></div></div></div></main></body>`;

check("topDivs: depth-balanced, comments ignored", () => {
  const d = topDivs(`<div a><div><div></div></div></div><p>x</p><div b></div><!-- <div c> -->`);
  assert.equal(d.length, 2); assert.equal(d[0].open, "<div a>"); assert.equal(d[1].open, "<div b>");
});
check("blocksOf: section children with a class, metadata blocks skipped, variants kept", () => {
  assert.deepEqual(blocksOf(home).map((b) => [b.name, b.variants]), [["cards", ["dark"]], ["hero", []]]);
  assert.match(blocksOf(home)[0].html, /nested <div>inner<\/div>/);
});
check("collectBlocks: first instance per class combination, pages per variant, unknown names filtered", () => {
  const blocks = collectBlocks([{ path: "/", html: home }, { path: "/about", html: about }], new Set(["cards", "hero"]));
  assert.deepEqual(blocks.map((b) => b.name), ["cards", "hero"]);
  const cards = blocks[0];
  assert.deepEqual([...cards.variants.keys()], ["dark", ""]);
  assert.equal(cards.variants.get("dark").from, "/"); assert.equal(cards.variants.get("dark").pages.size, 2);
  assert.deepEqual(cards.pages, ["/", "/about"]);
  assert.equal(collectBlocks([{ path: "/about", html: about }]).some((b) => b.name === "stray"), true);
});
check("blockDoc: one section per variant, each block followed by its library-metadata", () => {
  const [cards] = collectBlocks([{ path: "/", html: home }, { path: "/about", html: about }]);
  const doc = blockDoc(cards);
  assert.match(doc, /^<body>\n<header><\/header>\n<main>/);
  const sections = topDivs(doc.match(/<main>([\s\S]*)<\/main>/)[1]);
  assert.equal(sections.length, 2);
  const kids = topDivs(sections[0].inner).map((d) => d.open);
  assert.deepEqual(kids, ['<div class="cards dark">', '<div class="library-metadata">']);
  assert.match(sections[0].inner, /cards \(dark\): as authored on \/; used on 2 pages\./);
  assert.match(sections[1].inner, /cards: as authored on \/about; used on 1 page\./);
});
check("templateDoc: metadata → template-metadata, page-specific values emptied, the rest kept", () => {
  const doc = templateDoc(home);
  assert.doesNotMatch(doc, /class="metadata"/); assert.match(doc, /class="template-metadata"/);
  assert.match(doc, /<div>Title<\/div><div><\/div>/); assert.match(doc, /<div>JSON-LD<\/div><div><\/div>/);
  assert.match(doc, /<div>template<\/div><div>landing<\/div>/); assert.match(doc, /<div>og:type<\/div><div>website<\/div>/);
  assert.match(doc, /class="cards dark"/); assert.match(doc, /class="section-metadata"/);
});
check("sheet + names", () => {
  assert.deepEqual(sheet([{ a: 1 }]), { total: 1, limit: 1, offset: 0, data: [{ a: 1 }], ":type": "sheet" });
  assert.equal(templateName({ id: "products-detail-html" }), "Products detail");
  assert.equal(templateName({ id: "x", type: "article" }), "article");
  assert.equal(docName("Products detail"), "products-detail");
});
const ours = [{ title: "Blocks", path: "https://content.da.live/o/s/library/blocks.json" }, { title: "Templates", path: "https://content.da.live/o/s/library/templates.json" }];
check("mergeLibraryConfig: no config → a multi-sheet with the library tab only", () => {
  const m = mergeLibraryConfig(null, ours);
  assert.deepEqual(m[":names"], ["library"]); assert.equal(m[":type"], "multi-sheet"); assert.deepEqual(m.library.data, ours);
});
check("mergeLibraryConfig: other tabs and other library rows kept, ours replaced", () => {
  const existing = { ":names": ["data", "permissions", "library"], ":type": "multi-sheet", ":version": 3,
    data: { total: 1, limit: 1, offset: 0, data: [{ key: "editor.path", value: "/x" }] },
    permissions: { total: 1, limit: 1, offset: 0, data: [{ path: "CONFIG", groups: "g", actions: "write" }] },
    library: { total: 3, limit: 3, offset: 0, data: [{ title: "Blocks", path: "https://other/blocks.json" }, { title: " templates ", path: "https://other/t.json" }, { title: "Icons", path: "https://x/icons.json", format: ":<content>:" }] } };
  const m = mergeLibraryConfig(existing, ours);
  assert.deepEqual(m.data, existing.data); assert.deepEqual(m.permissions, existing.permissions);
  assert.deepEqual(m.library.data, [...ours, { title: "Icons", path: "https://x/icons.json", format: ":<content>:" }]);
  assert.equal(m.library.total, 3); assert.deepEqual(m[":names"], ["data", "permissions", "library"]);
  assert.equal(existing.library.data[0].path, "https://other/blocks.json", "input not mutated");
});
check("mergeLibraryConfig: a single-sheet config keeps its sheet under its name", () => {
  const m = mergeLibraryConfig({ ":type": "sheet", ":sheetname": "permissions", total: 1, data: [{ path: "CONFIG" }] }, ours);
  assert.deepEqual(m[":names"], ["permissions", "library"]); assert.deepEqual(m.permissions.data, [{ path: "CONFIG" }]);
  assert.equal(m.permissions[":type"], undefined);
});

// CLI: --dry-run from coverage, no network
const dir = mkdtempSync(join(tmpdir(), "da-library-"));
try {
  mkdirSync(join(dir, "content"), { recursive: true }); mkdirSync(join(dir, "blocks", "cards"), { recursive: true }); mkdirSync(join(dir, "blocks", "hero"), { recursive: true });
  mkdirSync(join(dir, "stardust", "rollout", "coverage"), { recursive: true });
  writeFileSync(join(dir, "content", "index.html"), home); writeFileSync(join(dir, "content", "about.html"), about);
  writeFileSync(join(dir, "content", "nav.html"), `<body><main><div><div class="cards"><div><div>nav</div></div></div></div></main></body>`);
  writeFileSync(join(dir, "stardust", "rollout", "rollout.json"), JSON.stringify({ site: { da: { org: "o", site: "s", ref: "main" } } }));
  writeFileSync(join(dir, "stardust", "rollout", "coverage", "pages.json"), JSON.stringify({ pages: [
    { slug: "about", path: "/about", templateId: "about-html", delivery: { status: "verified" } },
    { slug: "index", path: "/", templateId: "index", delivery: { status: "deployed" } },
    { slug: "later", path: "/later", templateId: "index", delivery: { status: "pending" } }] }));
  writeFileSync(join(dir, "stardust", "rollout", "coverage", "templates.json"), JSON.stringify({ templates: [{ id: "index", representativeSlug: "index", pages: ["index"] }] }));
  const r = spawnSync(process.execPath, [join(HERE, "..", "da-library.mjs"), "--dry-run"], { cwd: dir, encoding: "utf8", env: { ...process.env, DA_TOKEN: "" } });
  check("CLI --dry-run: exit 0, files written, representative page first, stray class and chrome left out", () => {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 blocks \(3 variants\) from 2 pages, 1 templates/);
    const out = join(dir, "stardust", "rollout", "library");
    assert.ok(existsSync(join(out, "blocks", "cards.html")) && existsSync(join(out, "blocks", "hero.html")) && !existsSync(join(out, "blocks", "stray.html")));
    assert.match(readFileSync(join(out, "blocks", "cards.html"), "utf8"), /cards \(dark\): as authored on \//);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "templates.json"), "utf8")).data, [{ key: "Index", value: "https://content.da.live/o/s/library/templates/index" }]);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "blocks.json"), "utf8")).data.map((x) => x.path), ["https://content.da.live/o/s/library/blocks/cards", "https://content.da.live/o/s/library/blocks/hero"]);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "library-rows.json"), "utf8")).map((x) => x.title), ["Blocks", "Templates"]);
  });
  const h = spawnSync(process.execPath, [join(HERE, "..", "da-library.mjs"), "--help"], { cwd: dir, encoding: "utf8" });
  check("--help prints usage, exit 0", () => { assert.equal(h.status, 0); assert.match(h.stdout, /da-library\.mjs/); });
} finally { rmSync(dir, { recursive: true, force: true }); }

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
