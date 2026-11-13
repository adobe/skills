#!/usr/bin/env node
// skills/rollout/scripts/test/da-library.test.mjs — the DA library (#160): authored blocks and their class variants lifted from DA bodies, block and template documents in the shape the DA library reads (a kept metadata value with a `$` pattern survives), sheets, chrome references, and a config merge that only replaces the rows this run writes; the CLI --dry-run writes the files from coverage or the content tree and touches no network; zero blocks exits 1; a symlinked path still runs; against a local fake DA: only templates are previewed, templates.json is left alone without templates, a 401 burst is retried and a persistent 401 exits 3.
// Run: node plugins/stardust/skills/rollout/scripts/test/da-library.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topDivs, blocksOf, collectBlocks, blockDoc, templateDoc, sheet, mergeLibraryConfig, templateName, docName, chromeRefs } from "../da-library.mjs";
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
check("templateDoc: a kept value with $$, $&amp;, $' or $` is copied verbatim; author / dates / image-alt emptied", () => {
  const vals = ["Save $$ now", "x $&amp; y", "q $' r", "b $` c"];
  const m = `<div class="metadata">${vals.map((v, i) => `<div><div>k${i}</div><div>${v}</div></div>`).join("")}<div><div>Author</div><div>Jane</div></div><div><div>published-time</div><div>2026-01-01</div></div><div><div>image-alt</div><div>alt</div></div></div>`;
  const doc = templateDoc(`<main><div>${m}</div></main>`);
  for (const v of vals) assert.ok(doc.includes(`<div>${v}</div>`), v);
  assert.equal((doc.match(/class="(template-)?metadata"/g) || []).length, 1);
  assert.match(doc, /<div>Author<\/div><div><\/div>/); assert.match(doc, /<div>published-time<\/div><div><\/div>/); assert.match(doc, /<div>image-alt<\/div><div><\/div>/);
});
check("chromeRefs: nav / footer metadata values as content paths", () => {
  const h = `<main><div><div class="metadata"><div><div>Footer</div><div>/footer-home</div></div><div><div>nav</div><div><a href="https://x.aem.page/nav-alt">https://x.aem.page/nav-alt</a></div></div><div><div>title</div><div>T</div></div></div></div></main>`;
  assert.deepEqual(chromeRefs(h), ["footer-home", "nav-alt"]); assert.deepEqual(chromeRefs(home), []);
});
check("sheet + names", () => {
  assert.deepEqual(sheet([{ a: 1 }]), { total: 1, limit: 1, offset: 0, data: [{ a: 1 }], ":type": "sheet" });
  assert.equal(templateName({ id: "products-detail-html" }), "Products detail");
  assert.equal(templateName({ id: "landing-a", type: "landing" }), "Landing a", "the unique id, not the shared type");
  assert.equal(templateName({ id: "x", label: "Home" }), "Home");
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
check("mergeLibraryConfig: a run without templates keeps an existing Templates row", () => {
  const existing = { ":names": ["library"], ":type": "multi-sheet", library: { data: [{ title: "Blocks", path: "old" }, { title: "Templates", path: "https://x/templates.json" }] } };
  const m = mergeLibraryConfig(existing, [ours[0]]);
  assert.deepEqual(m.library.data, [ours[0], { title: "Templates", path: "https://x/templates.json" }]);
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
  // a symlinked path: argv[1] is the link, import.meta.url the real file
  const real = join(dir, "real"); mkdirSync(real); copyFileSync(join(HERE, "..", "da-library.mjs"), join(real, "da-library.mjs")); symlinkSync(real, join(dir, "link"));
  const hs = spawnSync(process.execPath, [join(dir, "link", "da-library.mjs"), "--help"], { cwd: dir, encoding: "utf8" });
  check("through a symlinked directory the CLI still runs (--help prints usage)", () => { assert.equal(hs.status, 0); assert.match(hs.stdout, /da-library\.mjs/); });
  // a template whose representative is not delivered is named
  writeFileSync(join(dir, "stardust", "rollout", "coverage", "templates.json"), JSON.stringify({ templates: [{ id: "index", representativeSlug: "index" }, { id: "later-t", representativeSlug: "later" }] }));
  const rp = spawnSync(process.execPath, [join(HERE, "..", "da-library.mjs"), "--dry-run"], { cwd: dir, encoding: "utf8" });
  check("a template whose representative is not delivered yet is named on stderr; a block with no folder too", () => {
    assert.equal(rp.status, 0, rp.stderr); assert.match(rp.stderr, /template Later t: representative later not delivered yet/);
    assert.match(rp.stderr, /authored class "stray" \(on \/about\) has no blocks\/stray\/ folder/);
  });
} finally { rmSync(dir, { recursive: true, force: true }); }

// content-tree mode: chrome = root nav/footer + documents a page names; zero blocks → exit 1
const tree = mkdtempSync(join(tmpdir(), "da-library-tree-"));
try {
  mkdirSync(join(tree, "content", "library", "blocks"), { recursive: true });
  const withFooter = `<body><main><div><div class="hero"><div><div>H</div></div></div></div><div><div class="metadata"><div><div>footer</div><div>/footer-home</div></div></div></div></main></body>`;
  writeFileSync(join(tree, "content", "index.html"), withFooter);
  writeFileSync(join(tree, "content", "footer-home.html"), `<body><main><div><div class="links"><div><div>chrome</div></div></div></div></main></body>`);
  writeFileSync(join(tree, "content", "footer-faq.html"), `<body><main><div><div class="faq"><div><div>q</div></div></div></div></main></body>`);
  writeFileSync(join(tree, "content", "nav.html"), `<body><main><div><div class="menu"><div><div>m</div></div></div></div></main></body>`);
  writeFileSync(join(tree, "content", "library", "blocks", "old.html"), `<body><main><div><div class="old"><div><div>o</div></div></div></div></main></body>`);
  const t = spawnSync(process.execPath, [join(HERE, "..", "da-library.mjs"), "--dry-run", "--org", "o", "--site", "s"], { cwd: tree, encoding: "utf8" });
  check("content tree: a page named footer-* is content; the referenced footer, root nav and library/ are not", () => {
    assert.equal(t.status, 0, t.stderr);
    const names = JSON.parse(readFileSync(join(tree, "stardust", "rollout", "library", "blocks.json"), "utf8")).data.map((x) => x.name);
    assert.deepEqual(names, ["faq", "hero"]);
  });
  const empty = join(tree, "empty"); mkdirSync(join(empty, "content"), { recursive: true });
  writeFileSync(join(empty, "content", "index.html"), "<body><main><div><p>no blocks</p></div></main></body>");
  const z = spawnSync(process.execPath, [join(HERE, "..", "da-library.mjs"), "--org", "o", "--site", "s"], { cwd: empty, encoding: "utf8", env: { ...process.env, DA_TOKEN: "t", DA_SOURCE_BASE: "http://127.0.0.1:9/source" } });
  check("zero blocks: exit 1, nothing sent to DA", () => { assert.equal(z.status, 1, z.stderr); assert.match(z.stderr, /no authored block found/); assert.doesNotMatch(z.stdout, /put /); });
} finally { rmSync(tree, { recursive: true, force: true }); }

// against a local fake of admin.da.live + admin.hlx.page
const reqs = []; let mode = "ok"; const hits = {};
const server = createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    reqs.push(`${req.method} ${req.url}`);
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (mode === "dead401" || (mode === "burst" && hits[req.url] <= 2)) { res.writeHead(401); res.end(); return; }
    if (req.method === "GET" && req.url.startsWith("/config/")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ":type": "multi-sheet", ":names": ["library"], library: { data: [{ title: "Templates", path: "https://x/templates.json" }] } })); return; }
    res.writeHead(req.method === "PUT" || req.method === "POST" ? 201 : 200); res.end("{}");
  });
});
await new Promise((r) => { server.listen(0, "127.0.0.1", r); });
const B = `http://127.0.0.1:${server.address().port}`;
const site = mkdtempSync(join(tmpdir(), "da-library-net-"));
const runNet = () => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(HERE, "..", "da-library.mjs"), "--org", "o", "--site", "s"], { cwd: site, env: { ...process.env, DA_TOKEN: "tok", DA_SOURCE_BASE: `${B}/source`, DA_CONFIG_BASE: `${B}/config`, AEM_ADMIN_BASE: `${B}/admin`, DA_LIBRARY_BACKOFF_MS: "5" } });
  let out = ""; let err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => resolve({ code, out, err }));
});
try {
  mkdirSync(join(site, "content"), { recursive: true });
  writeFileSync(join(site, "content", "index.html"), `<body><main><div><div class="hero"><div><div>H</div></div></div></div></main></body>`);
  const r1 = await runNet();
  check("no templates: blocks doc PUT, no preview of a block doc, no templates.json PUT, existing Templates row kept", () => {
    assert.equal(r1.code, 0, r1.err + r1.out);
    assert.ok(reqs.includes("PUT /source/o/s/library/blocks/hero.html")); assert.ok(reqs.includes("PUT /source/o/s/library/blocks.json"));
    assert.ok(!reqs.some((q) => q.includes("templates.json")), reqs.join("\n")); assert.ok(!reqs.some((q) => q.startsWith("POST /admin/preview")));
    assert.match(r1.out, /config library tab \(Blocks\)/);
  });
  reqs.length = 0; mode = "burst"; Object.keys(hits).forEach((k) => { delete hits[k]; });
  writeFileSync(join(site, "content", "about.html"), `<body><main><div><div class="hero"><div><div>A</div></div></div></div></main></body>`);
  const r2 = await runNet();
  check("a 401 burst on a valid token is retried and the run completes", () => { assert.equal(r2.code, 0, r2.err + r2.out); assert.match(r2.out, /OK +library\/blocks\/hero/); assert.equal(reqs.filter((q) => q === "PUT /source/o/s/library/blocks/hero.html").length, 3, "401, 401, then 201"); });
  mode = "dead401";
  const r3 = await runNet();
  check("a 401 that persists through the retries exits 3 with the refresh hint", () => { assert.equal(r3.code, 3); assert.match(r3.err, /401 .* after retries — refresh DA_TOKEN/); });
} finally { server.close(); rmSync(site, { recursive: true, force: true }); }

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
