#!/usr/bin/env node
/**
 * skills/diff/scripts/content-diff.mjs
 *
 * Prototype ↔ EDS STRUCTURAL content + typography reconcile for the
 * stardust:deploy skill (Step 10, run alongside visual-diff.mjs).
 *
 * visual-diff.mjs reasons about PIXELS via heuristics (stretch / flush / blank /
 * colour) — it is structurally blind to "the right text is in the wrong slot" or
 * "one CTA is gone": the pixels are full, the colours plausible, nothing looks
 * blank, so no flag fires. Those are the failures it kept missing (the-people
 * eyebrow↔body swap #76, the dropped the-place CTA, the typography fork #77).
 *
 * This tool adds the missing layer: it extracts an ORDERED, role-classified
 * inventory of every text-bearing node ({role, text, href, alt}) from each page's
 * <main>, classifying by COMPUTED STYLE + tag (symmetric across the prototype's
 * .ds-* DOM and the EDS block DOM), then DIFFS the two inventories:
 *   - MISSING   a proto heading / CTA / eyebrow with no EDS match   (🔴 structural)
 *   - ROLE SWAP same text present but under a different role         (🔴 the #76 class)
 *   - MISSING BODY / EXTRA  body copy dropped / invented             (🟡 advisory)
 *   - FONT DIFF a matched line whose rendered FACE differs           (🟠 width probe, #77)
 *
 * Font detection uses a WIDTH PROBE, never document.fonts.check (which returns
 * true for any family name the page references, installed or not — #77): the same
 * normalised string at a fixed size under each element's computed family+weight;
 * a materially different width across pages ⇒ a different actual face.
 *
 * The classifier + differ live in content-inventory.mjs (SHARED with the deploy
 * skill's pre-code section-schema #93 and in-loop block-roundtrip #94 gates, so
 * every fidelity gate measures with the same instrument).
 *
 * Usage:
 *   node skills/diff/scripts/content-diff.mjs <prototypeURL> <edsURL> [options]
 *     --main <selector>   content root to compare        (default "main")
 *     --width <px>        viewport width                 (default 1280)
 *     --json              also print the two raw inventories
 *
 * Exit codes: 0 ran (flags are advisory, they do NOT fail the run), 1 error.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, newline-per-chained-call, no-continue, no-multi-spaces */
/* standalone dev tool: playwright is a devDependency; sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { resolveProfile } from './diff-profiles.mjs';
import { inventory, diffInventories, summarise } from './content-inventory.mjs';

function parseArgs(argv) {
  const [, , proto, eds, ...rest] = argv;
  const opts = { main: null, width: 1280, json: false, profile: 'eds' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
  }
  return { proto, eds, opts };
}

async function grab(browser, url, opts, prof) {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // scroll through to trigger reveal-on-scroll / lazy nodes, then return to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const inv = await page.evaluate(inventory, [opts.main || prof.mainDefault, prof.eyebrow]);
  await ctx.close();
  return inv;
}

async function main() {
  const { proto, eds, opts } = parseArgs(process.argv);
  if (!proto || !eds) {
    process.stderr.write('usage: node skills/diff/scripts/content-diff.mjs <sourceURL> <buildURL> [--profile eds|generic] [--main sel] [--width px] [--json]\n');
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  const browser = await chromium.launch();
  let srcInv; let tgtInv;
  try {
    srcInv = await grab(browser, proto, opts, prof);
    tgtInv = await grab(browser, eds, opts, prof);
  } finally {
    await browser.close();
  }

  const { flags } = diffInventories(srcInv.items, tgtInv.items, prof);
  process.stdout.write(`\nContent diff @ ${opts.width}px (profile "${prof.name}", root "${opts.main || prof.mainDefault}")\n`);
  process.stdout.write(`  ${prof.source}: ${summarise(srcInv)}\n`);
  process.stdout.write(`  ${prof.target}: ${summarise(tgtInv)}\n`);

  if ((srcInv.items.length < 3 || tgtInv.items.length < 3)) {
    process.stdout.write('\n⚠ one side has almost no content — a blank/failed render; fix that before trusting the diff.\n');
  }

  const order = { '🔴': 0, '🟠': 1, '🟡': 2 };
  flags.sort((a, b) => order[a.sev] - order[b.sev]);
  const strong = flags.filter((f) => f.sev === '🔴').length;
  process.stdout.write(`\nFindings: ${flags.length ? `${flags.length} (${strong} structural 🔴)` : 'none — content + roles match'}\n`);
  flags.forEach((f) => process.stdout.write(`  ${f.sev} ${f.kind}: ${f.msg}\n`));

  if (opts.json) {
    process.stdout.write('\nInventories JSON:\n');
    process.stdout.write(`${JSON.stringify({ [prof.source]: srcInv, [prof.target]: tgtInv }, null, 1)}\n`);
  }
}

main().catch((e) => { process.stderr.write(`content-diff error: ${e.message}\n`); process.exit(1); });
