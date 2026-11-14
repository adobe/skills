#!/usr/bin/env node
// skills/deploy/scripts/test/davids-model-lint.test.mjs — D15 / #134: CSS authored as content.
// The recorded defect: a hero-carousel with one cell per slide reading "padding: 200px 10px 10px 50px",
// visible in DA as body text, that decorate() copied into el.style. Every gate passed because the text is
// never displayed. The lint must flag it 🔴, and must stay quiet on ordinary "Label: value" copy.
// Run: node plugins/stardust/skills/deploy/scripts/test/davids-model-lint.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LINT = fileURLToPath(new URL("../davids-model-lint.mjs", import.meta.url));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };

const IMG = '<picture><img src="https://content.da.live/o/r/media/a.jpg" alt="Slide"></picture>';
const page = (body) => `<body><header></header><main>${body}</main><footer></footer></body>`;
const block = (name, rows) => `<div><div class="${name}">${rows.map((cells) => `<div>${cells.map((c) => `<div>${c}</div>`).join("")}</div>`).join("")}</div></div>`;

function lint(html) {
  const dir = mkdtempSync(path.join(tmpdir(), "dml-"));
  try {
    const f = path.join(dir, "index.html");
    writeFileSync(f, html);
    const r = spawnSync(process.execPath, [LINT, f, "--json"], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 2, `lint crashed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const d15 = (out) => out.findings.filter((f) => f.rule === "D15");

check("recorded defect: per-slide padding declaration cell is 🔴 D15", () => {
  const out = lint(page(block("hero-carousel", [
    [IMG, '<p><a href="https://example.com/a">Get started</a></p>', "<p>padding: 200px 10px 10px 50px</p>"],
    [IMG, '<p><a href="https://example.com/b">Get Started</a></p>', "<p>padding: 200px 10px 10px 750px</p>"],
  ])));
  const hits = d15(out).filter((f) => f.sev === "🔴" && /CSS declaration/.test(f.msg));
  assert.equal(hits.length, 2, JSON.stringify(out.findings, null, 1));
  assert.match(hits[0].msg, /row 1 cell 3/);
  assert.match(hits[0].msg, /#134/);
  assert.equal(out.red, 2);
});

check("multiple declarations, trailing semicolon, entity-encoded, and --token assignments are 🔴", () => {
  for (const cell of [
    "<p>padding: 20px; color: #fff;</p>", "<p>padding: 190px 10px 0 35px; size: auto</p>",
    "<p>background:&nbsp;rgba(0,0,0,.5)</p>",
    "<p>--accent: #1473e6</p>",
    "<p>text-align: center</p>",
    "<p>margin-top: 0</p>",
    "<p>grid-template-columns: 1fr 2fr</p>",
  ]) {
    const out = lint(page(block("cards", [[IMG, cell]])));
    assert.equal(d15(out).filter((f) => f.sev === "🔴").length, 1, cell);
  }
});

check("bare lengths and a lone hex colour are 🟡 (advisory — a spec table may legitimately hold them)", () => {
  for (const cell of ["<p>200px 10px 10px 50px</p>", "<p>48px</p>", "<p>#1473E6</p>"]) {
    const out = lint(page(block("cards", [[IMG, cell]])));
    const f = d15(out);
    assert.equal(f.length, 1, cell);
    assert.equal(f[0].sev, "🟡", cell);
    assert.equal(out.red, 0, cell);
  }
});

check("a CSS-only default-content paragraph is 🔴 too", () => {
  const out = lint(page("<div><h2>Band</h2><p>padding: 64px 0</p></div>"));
  assert.equal(d15(out).filter((f) => f.sev === "🔴").length, 1);
});

check("ordinary 'Label: value' copy, variant keywords and section-metadata styles stay clean", () => {
  const legit = [
    "<p>Phone: +1 555 010 2000</p>",
    "<p>Opening hours: 10am – 6pm</p>",
    "<p>Color: Red</p>",
    "<p>Width: 120 cm</p>",
    "<p>Price: 200</p>",
    "<p>Position: Senior Engineer</p>",
    "<p>Display: Retina</p>",
    "<p>Order: 5 items</p>",
    "<p>left</p>",
    "<p>dark</p>",
    "<p>Padding and margins are set by the designer.</p>",
    "<p>Read more: https://example.com/a; then sign up.</p>",
    "<p>color: text-only teaser boxes, 6-up grid</p>", // prose that contains a CSS word (recorded false positive)
    "<p>1970s</p>", "<p>40s</p>", "<p>2000s</p>",     // decades, not seconds (recorded false positive)
    "<p>display: 6.1-inch OLED</p>",
  ];
  for (const cell of legit) {
    const out = lint(page(block("cards", [[IMG, cell]])));
    assert.equal(d15(out).length, 0, `${cell} → ${JSON.stringify(d15(out))}`);
  }
  const meta = lint(page('<div><h2>Band</h2><p>Copy.</p><div class="section-metadata"><div><div>style</div><div>dark, wide</div></div></div></div>'));
  assert.equal(d15(meta).length, 0, JSON.stringify(d15(meta)));
  // Key-value blocks are configuration (D14): a colour or a length as a VALUE is legitimate there.
  const kv = lint(page('<div><h2>Band</h2><p>Copy.</p><div class="metadata"><div><div>theme-color</div><div>#1473e6</div></div><div><div>color</div><div>text-only teaser boxes, 6-up grid</div></div></div></div>'));
  assert.equal(d15(kv).length, 0, JSON.stringify(d15(kv)));
});

check("the pre-existing D15 checks still fire (markup as text, inline-script text)", () => {
  const out = lint(page("<div><p>&lt;div class=\"x\"&gt; here</p><p>try { window.X.wcm = 1 }</p></div>"));
  assert.equal(d15(out).filter((f) => f.sev === "🔴").length, 2, JSON.stringify(out.findings));
});

console.log(failed ? `\n${failed} failing` : "\nall passing");
process.exit(failed ? 1 : 0);
