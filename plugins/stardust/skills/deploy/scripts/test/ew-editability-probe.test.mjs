#!/usr/bin/env node
// skills/deploy/scripts/test/ew-editability-probe.test.mjs — aggregate(): an @ew-exempt tag never covers a cell whose
// text is CSS (#134). Recorded: a hero-carousel's `padding: 200px 10px 10px 50px` config cells were counted
// "3 exempt (config)" by the round-trip gate; they must count DEAD so the gate fails. Pure — no browser.
// Run: node plugins/stardust/skills/deploy/scripts/test/ew-editability-probe.test.mjs
import assert from "node:assert/strict";
import { aggregate, verdict, parseExemptTags, parseVariantTags } from "../ew-editability-probe.mjs";
import { cssAsText } from "../css-as-text.mjs";
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split("\n").join("\n  ")}`); } };

const JSDOC = `/**\n * hero-carousel — slider\n * @ew-exempt config — the padding cell is slide configuration, not copy\n */\nexport default function decorate() {}`;
const exemptions = { "hero-carousel": { ...parseExemptTags(JSDOC), source: "@ew-exempt" } };
const row = (text, hits = 0) => ({ block: "hero-carousel", tag: "p", text, hits, sameText: true });

check("recorded defect: @ew-exempt config does NOT cover a padding-declaration cell — dead, gate fails", () => {
  const agg = aggregate([
    row("Get started", 1), row("padding: 200px 10px 10px 50px"),
    row("Get Started", 1), row("padding: 200px 10px 10px 750px"),
    row("Learn more", 1), row("padding: 190px 10px 0 35px; size: auto"),
  ], { exemptions });
  const b = agg.blocks[0];
  assert.equal(b.editable, 3);
  assert.equal(b.exempt, 0);
  assert.equal(b.dead, 3, JSON.stringify(b));
  assert.match(b.deadItems[0].label, /CSS as content, not covered by @ew-exempt \(#134\)/);
  assert.equal(verdict(agg).dead, true);
});

check("a genuine exempt text (a keyword variant, an ISO date, a label|value key) stays exempt", () => {
  const agg = aggregate([row("left"), row("2026-10-21"), row("icon | star"), row("#1473e6")], { exemptions });
  const b = agg.blocks[0];
  assert.equal(b.dead, 0, JSON.stringify(b));
  assert.equal(b.exempt, 4);
  assert.equal(verdict(agg).dead, false);
});

check("without any exemption a dead CSS cell is still just dead (no double count)", () => {
  const agg = aggregate([row("padding: 20px")], { exemptions: {} });
  assert.equal(agg.blocks[0].dead, 1);
  assert.equal(agg.totals.dead, 1);
});

check("the shared classifier agrees with the lint's tiers", () => {
  assert.equal(cssAsText("padding: 200px 10px 10px 50px").sev, "🔴");
  assert.equal(cssAsText("--accent: #1473e6").sev, "🔴");
  assert.equal(cssAsText("#1473e6").sev, "🟡");
  assert.equal(cssAsText("1970s"), null);
  assert.equal(cssAsText("color: text-only teaser boxes, 6-up grid"), null);
});

const VJSDOC = `/**\n * hero-carousel — slider\n * @variants cell 3: left | right (default left) — one word per row, mapped to .slide-cta-right\n * @ew-exempt metadata — the variant cell is never displayed\n */\nexport default function decorate() {}`;
const vex = { "hero-carousel": { ...parseExemptTags(VJSDOC), source: "@ew-exempt" } };

check("@variants: the vocabulary parses (default clause and trailing prose dropped)", () => {
  assert.deepEqual([...vex["hero-carousel"].variants].sort(), ["left", "right"]);
  assert.deepEqual([...parseVariantTags(" * @variants dark | light ")].sort(), ["dark", "light"]);
  assert.equal(parseExemptTags(JSDOC).variants.size, 0);
});

check("route 2 after the fix: a declared variant word per row is exempt; a typo or an undeclared word is dead", () => {
  const ok = aggregate([row("Get started", 1), row("left"), row("Get Started", 1), row("right"), row("Learn more", 1), row("Left")], { exemptions: vex });
  assert.equal(ok.blocks[0].dead, 0, JSON.stringify(ok.blocks[0]));
  assert.equal(ok.blocks[0].exempt, 3);
  const bad = aggregate([row("Get started", 1), row("rigth"), row("Get Started", 1), row("centre")], { exemptions: vex });
  assert.equal(bad.blocks[0].dead, 2, JSON.stringify(bad.blocks[0]));
  assert.match(bad.blocks[0].deadItems[0].label, /not a declared variant word \(@variants: left \| right\)/);
  assert.equal(verdict(bad).dead, true);
});

check("@variants: multi-word exempt texts (a date, a label|value key) are not judged as variant words", () => {
  const agg = aggregate([row("2026-10-21"), row("icon | star"), row("Hello world")], { exemptions: vex });
  assert.equal(agg.blocks[0].dead, 1, JSON.stringify(agg.blocks[0])); // "2026-10-21" is one token outside the set — declared vocabularies are strict
  assert.equal(agg.blocks[0].exempt, 2);
});

console.log(failed ? `\n${failed} failing` : "\nall passing");
process.exit(failed ? 1 : 0);
