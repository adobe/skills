#!/usr/bin/env node
/**
 * section-schema.mjs — per-section ENCODE/DECODE contract generator (#93).
 *
 * The root cause of the dropped-CTA / role-swap / flattened-variant defect class
 * is that the authored rows (ENCODE) and the block's decorate() (DECODE) are
 * written independently and hoped to be inverses. This script makes the contract
 * explicit and SHARED: it renders the prototype and emits, per <section>, the
 * ordered role-classified content inventory (heading / eyebrow / cta+href / body
 * — the SAME classifier content-diff and block-roundtrip use, from
 * skills/diff/scripts/content-inventory.mjs) plus the repeating-unit groups
 * (count + per-unit composition). Both sides are then written FROM the schema:
 *   - ENCODE: one row per repeat unit, fields in schema order; every schema item
 *     appears in the authored content (an item with no row is a drop you chose).
 *   - DECODE: the block classifies exactly the roles the schema lists; the
 *     schema's unit composition is the post-decorate count assertion.
 * block-roundtrip.mjs (#94) then verifies the round-trip actually closed.
 *
 * Usage:
 *   node skills/deploy/scripts/section-schema.mjs <prototypeURL> [options]
 *     --out <file>     write JSON here (default stdout)
 *     --width <px>     viewport width (default 1280)
 *     --profile <p>    eds | generic — eyebrow classifier thresholds (default eds)
 *
 * The prototype must be RENDERABLE (serve static prototypes from their own dir;
 * pre-render JSX first — deploy SKILL.md Step 1). file:// works when the
 * prototype's CSS is inline.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { resolveProfile } from '../../diff/scripts/diff-profiles.mjs';
import { inventory } from '../../diff/scripts/content-inventory.mjs';

function parseArgs(argv) {
  const [, , url, ...rest] = argv;
  const opts = { out: null, width: 1280, profile: 'eds' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
  }
  return { url, opts };
}

// Runs IN the page: tag every top-level prototype section with data-ss-idx and
// return its name, then detect repeating-unit groups per section (same grouping
// idea as style-fingerprint.mjs #90, but CONTENT-shaped: what a repeat unit
// contains, so ENCODE knows what "one row per unit" must carry).
/* eslint-disable no-undef */
function mapSections() {
  const root = document.querySelector('main') || document.body;
  const all = [...root.querySelectorAll('section, [data-section]')];
  const top = all.filter((s) => !s.parentElement.closest('section, [data-section]'));
  const sections = top.length ? top : all;
  const out = [];
  sections.forEach((sec, idx) => {
    sec.setAttribute('data-ss-idx', String(idx));
    const name = sec.getAttribute('data-section') || (sec.className || '').toString().split(' ')[0] || `section-${idx}`;

    // Repeating-unit groups: containers whose direct children form >=2 same
    // tag+class siblings that carry content. Outermost groups only — a card's
    // inner list is part of the card unit, not a second group.
    const reported = [];
    const groups = [];
    for (const c of [sec, ...sec.querySelectorAll('*')]) {
      if (reported.some((r) => r !== c && r.contains(c))) continue; // inside a reported unit
      const byKey = {};
      [...c.children].forEach((k) => {
        const key = `${k.tagName}.${(k.className || '').toString().split(' ')[0] || ''}`;
        (byKey[key] ||= []).push(k);
      });
      for (const [key, members] of Object.entries(byKey)) {
        if (members.length < 2) continue;
        const compose = (el) => ({
          headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
          ctas: [...el.querySelectorAll('a')].filter((a) => a.textContent.trim() && !a.querySelector('img,picture')).length,
          imgs: el.querySelectorAll('img,picture').length,
          textRuns: [...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length,
        });
        const units = members.map(compose);
        const hasContent = units.some((u) => u.headings || u.ctas || u.imgs || u.textRuns);
        if (!hasContent) continue;
        const sig = (u) => `${u.headings}|${u.ctas}|${u.imgs}|${u.textRuns}`;
        groups.push({
          unitSelector: key,
          count: members.length,
          unit: units[0],
          uniform: units.every((u) => sig(u) === sig(units[0])),
        });
        reported.push(...members);
      }
    }
    out.push({ idx, section: name, repeats: groups });
  });
  return out;
}
/* eslint-enable no-undef */

async function main() {
  const { url, opts } = parseArgs(process.argv);
  if (!url) {
    process.stderr.write('usage: node skills/deploy/scripts/section-schema.mjs <prototypeURL> [--out file] [--width px] [--profile eds|generic]\n');
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  const browser = await chromium.launch();
  let sections;
  try {
    // reducedMotion matches content-diff's grab(): all three gates must inventory
    // the same settled DOM, or an entrance animation flips a role across gates.
    const page = await browser.newPage({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);

    const mapped = await page.evaluate(mapSections);
    sections = [];
    for (const m of mapped) {
      const inv = await page.evaluate(inventory, [`[data-ss-idx="${m.idx}"]`, prof.eyebrow]);
      sections.push({
        section: m.section,
        items: inv.items.map(({ role, order, text, href }) => (href !== undefined ? { role, order, text, href } : { role, order, text })),
        imgCount: inv.imgCount,
        repeats: m.repeats,
      });
    }
  } finally {
    await browser.close();
  }

  const schema = { source: url, width: opts.width, profile: prof.name, sections };
  const json = JSON.stringify(schema, null, 1);
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, `${json}\n`);
    const totals = sections.map((s) => `${s.section}(${s.items.length} items${s.repeats.length ? `, ${s.repeats.map((r) => `${r.count}×${r.unitSelector}`).join('+')}` : ''})`).join(', ');
    process.stdout.write(`schema → ${opts.out}\n${sections.length} sections: ${totals}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

main().catch((e) => { process.stderr.write(`section-schema error: ${e.message}\n`); process.exit(1); });
