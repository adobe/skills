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
 * skills/deploy/scripts/content-inventory.mjs) plus the repeating-unit groups
 * (count + per-unit composition). Both sides are then written FROM the schema:
 *   - ENCODE: one row per repeat unit, fields in schema order; every schema item
 *     appears in the authored content (an item with no row is a drop you chose).
 *   - DECODE: the block classifies exactly the roles the schema lists; the
 *     schema's unit composition is the post-decorate count assertion.
 * block-roundtrip.mjs (#94) then verifies the round-trip actually closed.
 *
 * `editableTexts` (per section) is the ENCODE-side expected editable count for
 * the Experience Workspace gate: the number of OUTERMOST h1-h6/p/ul/ol/pre/
 * blockquote elements in the prototype section that carry visible text — the set
 * the da.live canvas stamps `data-prose-index` on and can attach an inline editor
 * to (deploy reference/block-js-scaffold.md § Experience Workspace editability contract). ENCODE authors
 * one such element per item (a list is ONE editable unit); after decorate() the
 * `--ew` gate (block-roundtrip / ew-editability-probe) must find the same number
 * of surviving instrumented elements — fewer means authored elements were rebuilt,
 * merged or synthesized (EW1), and the block is not editable in the workspace.
 *
 * `structure` (per section, T28.4 — audit-and-naming.md § 2b): `{ interactive: [<selectors matched>],
 * columns: <n> }` — interactive = descendants matching button/input/select/textarea/form/details,
 * tab roles, aria-expanded/-controls or framework mounts (schema-checks.mjs INTERACTIVE_SELECTORS; a
 * `{{…}}` text node counts as `text {{…}}`); columns = the largest count of content-bearing direct
 * children of one container whose boxes share a top and differ in left at the schema width. A
 * section triaged to default content (`defaultContent: true` | `{ reason, dynamicsRow }` — carried
 * over from an existing --out file) that carries structure prints `⚠ generic-with-structure <section>:
 * interactive=[…] columns=n` here and FAILs `qa-gate.mjs --schema` while it renders as prose.
 * `hasH1` marks the section that holds the authored <h1> (qa-gate's h1Section check, T21.2).
 *
 * Usage:
 *   node skills/deploy/scripts/section-schema.mjs <prototypeURL> [options]
 *     --out <file>     write JSON here (default stdout; an existing file's `defaultContent` and
 *                      `decodeTier` per section name are kept)
 *     --width <px>     viewport width (default 1280)
 *     --profile <p>    eds | generic — eyebrow classifier thresholds (default eds)
 *
 * The prototype must be RENDERABLE (serve static prototypes from their own dir;
 * pre-render JSX first — deploy reference/audit-and-naming.md § 1. Audit). file:// works when the
 * prototype's CSS is inline.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
// Dependencies through the resolution chain (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md
// § Resolution chain): plugin layout, then a project copy made as a set (harness-permissions.md § Two classes);
// a lone copy without the helper falls back to the bare import it resolved before. A miss at every link is one
// line naming preflight-runtime.mjs, exit 2 (no verdict — the same class as 124).
const CHAIN = await (async () => { for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return null; })();
const loadDep = (name) => (CHAIN ? CHAIN.resolveDep(name, { from: import.meta.url }) : import(name).then((m) => ('module.exports' in m ? m['module.exports'] : (m.default && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in m.default) ? m.default : m))));
const preflightExit = (e) => { console.error(e.message); process.exit(2); };
const { chromium } = await loadDep('playwright').catch(preflightExit);
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveProfile } from './diff-profiles.mjs';
import { inventory, editableInventory } from './content-inventory.mjs';
import { flagGenericWithStructure, INTERACTIVE_SELECTORS, MUSTACHE_MARKER, repeatUnitGroups, inPageCall } from './schema-checks.mjs';

function parseArgs(argv) {
  const [, , url, ...rest] = argv;
  const opts = { out: null, width: 1280, profile: 'eds' };
  const value = (i, flag) => { const v = rest[i]; if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = value(i += 1, a); }
    else if (a === '--width') { opts.width = Number(value(i += 1, a)); }
    else if (a === '--profile') { opts.profile = value(i += 1, a); }
  }
  return { url, opts };
}

// Runs IN the page: tag every top-level prototype section with data-ss-idx and
// return its name, then detect repeating-unit groups per section (same grouping
// idea as style-fingerprint.mjs #90, but CONTENT-shaped: what a repeat unit
// contains, so ENCODE knows what "one row per unit" must carry).
/* eslint-disable no-undef */
/* global repeatUnitGroups -- defined in scope by inPageCall (schema-checks.mjs) */
function mapSections(structureArgs) {
  const INTERACTIVE = (structureArgs && structureArgs.interactive) || [];
  const MUSTACHE = (structureArgs && structureArgs.mustache) || 'text {{…}}';
  // T28.4 structure facts: what makes a section NOT prose — interactive descendants and side-by-side columns
  const structureFacts = (sec) => {
    const interactive = INTERACTIVE.filter((sel) => { try { return !!sec.querySelector(sel); } catch { return false; } });
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (n.textContent.includes('{{')) { interactive.push(MUSTACHE); break; } }
    const bearing = (el) => el.getBoundingClientRect().width > 0 && (el.textContent.trim().length > 0 || el.querySelector('img,picture,svg,video,iframe'));
    let columns = 0;
    for (const c of [sec, ...sec.querySelectorAll('*')]) {
      const kids = [...c.children].filter(bearing);
      if (kids.length < 2) continue;
      const rows = new Map(); // top (rounded) → distinct lefts
      for (const k of kids) { const r = k.getBoundingClientRect(); const top = Math.round(r.top / 4) * 4; if (!rows.has(top)) rows.set(top, new Set()); rows.get(top).add(Math.round(r.left)); }
      for (const lefts of rows.values()) columns = Math.max(columns, lefts.size);
    }
    return { interactive, columns };
  };
  const root = document.querySelector('main') || document.body;
  const all = [...root.querySelectorAll('section, [data-section]')];
  const top = all.filter((s) => !s.parentElement.closest('section, [data-section]'));
  const sections = top.length ? top : all;
  const out = [];
  const seen = {};
  sections.forEach((sec, idx) => {
    sec.setAttribute('data-ss-idx', String(idx));
    const base = sec.getAttribute('data-section') || (sec.className || '').toString().split(' ')[0] || `section-${idx}`;
    // repeated section names get an ordinal (hp-band, hp-band-2, …) so qa-gate.mjs binds each schema section to its own block
    seen[base] = (seen[base] || 0) + 1;
    const name = seen[base] > 1 ? `${base}-${seen[base]}` : base;

    // Repeating-unit groups — the ONE rule is schema-checks.mjs repeatUnitGroups (browser-free module;
    // replica's layout-cluster / variant-census inject the same source). Elements never cross the boundary.
    const groups = repeatUnitGroups(sec).map(({ unitSelector, count, unit, uniform }) => ({ unitSelector, count, unit, uniform }));
    out.push({ idx, section: name, repeats: groups, structure: structureFacts(sec), hasH1: !!sec.querySelector('h1') });
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

    const mapped = await page.evaluate(inPageCall(mapSections, { interactive: INTERACTIVE_SELECTORS, mustache: MUSTACHE_MARKER }, { repeatUnitGroups }));
    sections = [];
    for (const m of mapped) {
      const inv = await page.evaluate(inventory, [`[data-ss-idx="${m.idx}"]`, prof.eyebrow]);
      const editable = await page.evaluate(editableInventory, [`[data-ss-idx="${m.idx}"]`]);
      sections.push({
        section: m.section,
        items: inv.items.map(({ role, order, text, href }) => (href !== undefined ? { role, order, text, href } : { role, order, text })),
        imgCount: inv.imgCount,
        editableTexts: editable.count,
        repeats: m.repeats,
        structure: m.structure,
        ...(m.hasH1 ? { hasH1: true } : {}),
      });
    }
  } finally {
    await browser.close();
  }

  // Step 2b decisions recorded on an earlier run of the same file survive a re-measure (defaultContent, decodeTier)
  const previous = opts.out && fs.existsSync(opts.out) ? (() => { try { return JSON.parse(fs.readFileSync(opts.out, 'utf8')); } catch { return null; } })() : null;
  if (previous && Array.isArray(previous.sections)) {
    const byName = new Map(previous.sections.map((s) => [s.section, s]));
    for (const s of sections) { const old = byName.get(s.section); if (!old) continue; for (const k of ['defaultContent', 'decodeTier']) if (old[k] !== undefined) s[k] = old[k]; }
  }
  const schema = { source: url, width: opts.width, profile: prof.name, sections };
  const json = JSON.stringify(schema, null, 1);
  const flagged = flagGenericWithStructure(schema);
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, `${json}\n`);
    const totals = sections.map((s) => `${s.section}(${s.items.length} items${s.repeats.length ? `, ${s.repeats.map((r) => `${r.count}×${r.unitSelector}`).join('+')}` : ''}, ${s.editableTexts} editable${s.structure && (s.structure.interactive.length || s.structure.columns >= 2) ? `, ${s.structure.interactive.length ? `interactive ${s.structure.interactive.length}` : ''}${s.structure.interactive.length && s.structure.columns >= 2 ? ' ' : ''}${s.structure.columns >= 2 ? `${s.structure.columns} cols` : ''}` : ''})`).join(', ');
    process.stdout.write(`schema → ${opts.out}\n${sections.length} sections: ${totals}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  for (const f of flagged) process.stdout.write(`⚠ generic-with-structure ${f.section}: ${f.facts}${f.reason || f.dynamicsRow ? ` — recorded: ${f.dynamicsRow ? `dynamics row ${f.dynamicsRow}` : ''}${f.dynamicsRow && f.reason ? ', ' : ''}${f.reason || ''}` : ' — needs a block or a dynamics row before conversion (audit-and-naming.md § 2b)'}\n`);
}

export { mapSections }; // in-page mapper; the repeat-unit grouping itself is schema-checks.mjs repeatUnitGroups (browser-free — replica imports it there)

const isMain = (() => { try { return process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { process.stderr.write(`section-schema error: ${e.message}\n`); process.exit(1); });
