#!/usr/bin/env node
/**
 * block-roundtrip.mjs — in-loop per-block ENCODE→DECODE round-trip assertion (#94).
 *
 * Step 10's content-diff proves fidelity AFTER deploy — too late to be the place
 * where defects are FOUND. This gate runs at block-authoring time, per block,
 * with no DA and no dev server (the render-harness technique): it decorates the
 * authored content locally with the block's own JS+CSS, extracts the role
 * inventory from the decorated section AND from the matching prototype section
 * (the SAME classifier as content-diff — skills/deploy/scripts/content-inventory.mjs),
 * and diffs them. A structural 🔴 (MISSING CTA/HEADING/EYEBROW, ROLE SWAP) exits
 * non-zero, so the authoring loop fixes the decode before anything ships. Font
 * forks are NOT checked here (the harness renders local fonts — face fidelity is
 * Step 4 + Step 10's business); structure and roles are.
 *
 * A block is DONE when this passes — Step 10 then only proves the round-trip
 * survived DA transport.
 *
 * Usage:
 *   node skills/deploy/scripts/block-roundtrip.mjs <prototypeURL> <content/page.html> [options]
 *     --blocks a,b,c     block names to check (default: every block div found in the page)
 *     --map name=sel     prototype section selector for a block (repeatable;
 *                        default tries section.<name>, [data-section="<name>"], .<name>)
 *     --styles <path>    foundation CSS (default eds/styles/styles.css, then styles/styles.css)
 *     --blocks-dir <dir> blocks root (default eds/blocks, then blocks)
 *     --width <px>       viewport width (default 1280)
 *     --profile <p>      eds | generic (default eds)
 *     --ew | --no-ew     Experience Workspace editability gate (default ON): before
 *                        decorate() the authored content is instrumented like the
 *                        da.live canvas (`data-prose-index` on every outermost
 *                        h1-h6/p/ul/ol/pre/blockquote, bare-text cells re-wrapped
 *                        as <p>); afterwards each text must survive on EXACTLY one
 *                        element. Dead (rebuilt from textContent/innerHTML,
 *                        synthesized, retagged) or duplicated (clone slides) texts
 *                        are 🔴 alongside MISSING CTA/HEADING; `@ew-exempt <reason>`
 *                        in the block's leading JSDoc declares config/derived/index
 *                        texts (⚪ advisory). Shared instrument: ew-editability-probe.mjs.
 *     --json             dump per-block inventories (+ the editability survey)
 *
 * EW contract in two sentences (deploy SKILL.md § Experience Workspace editability
 * contract, EW1–EW10): the workspace stamps an index on every authored text element,
 * runs the page's own decorate() over it, and can only attach an editor to an element
 * that still carries its index — so block JS must MOVE authored h1-h6/p/ul/ol/picture
 * nodes into generated wrappers (append/prepend), never rebuild them from text or
 * clone-and-discard. Wrappers carry the layout classes; presentational clones strip
 * instrumentation; exempt text is declared with `@ew-exempt`, never silently dropped.
 *
 * Exit codes: 0 = round-trip closed (no structural 🔴, no dead/duplicated text, no
 * decorate errors), 2 = structural 🔴 found (incl. DEAD TEXT / DUPLICATED INDEX under
 * --ew) OR a block's decorate() failed to install/run (a block that cannot be
 * decorated must never pass — its raw rows would match the prototype and
 * green-light a decode that was never exercised), 1 = tool error.
 *
 * Limitation: block JS is INLINED into the harness page, so module-scope
 * `import` statements cannot be resolved — such a block FAILS the gate loudly
 * (inline the helper, or verify that block via the dev-server harness + Step 10).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import fs from 'fs';
import { resolveProfile } from './diff-profiles.mjs';
import { inventory, diffInventories, summarise } from './content-inventory.mjs';
import { EDITABLE, runtimeMimic, instrument, survey, installBlockJs, runDecorate, readBlockExemptions, aggregate } from './ew-editability-probe.mjs';

function parseArgs(argv) {
  const [, , proto, content, ...rest] = argv;
  const opts = { blocks: null, map: {}, styles: null, blocksDir: null, width: 1280, profile: 'eds', json: false, ew: true };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--blocks') { opts.blocks = rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--map') { const [k, ...v] = rest[i += 1].split('='); opts.map[k] = v.join('='); }
    else if (a === '--styles') { opts.styles = rest[i += 1]; }
    else if (a === '--blocks-dir') { opts.blocksDir = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--ew') { opts.ew = true; }
    else if (a === '--no-ew') { opts.ew = false; }
  }
  return { proto, content, opts };
}

const firstExisting = (cands, kind) => {
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`no ${kind} found (tried ${cands.join(', ')}) — pass it explicitly`);
  return hit;
};

// In the PROTOTYPE page: tag each section matching a block with data-rt="<name>-<i>".
/* eslint-disable no-undef */
function tagProtoSections(specs) {
  const out = {};
  specs.forEach(({ name, selector }) => {
    const cands = selector ? [selector] : [`section.${name}`, `[data-section="${name}"]`, `.${name}`];
    let els = [];
    for (const sel of cands) {
      try { els = [...document.querySelectorAll(sel)]; } catch { els = []; }
      if (els.length) break;
    }
    els.forEach((el, i) => el.setAttribute('data-rt', `${name}-${i}`));
    out[name] = els.length;
  });
  return out;
}

// In the HARNESS page: tag each top-level section OWNING a block div with
// data-rt="<name>-<i>" (the section, not the block — default-content siblings a
// block reabsorbs, or a section head authored before the block, belong to the
// same round-trip unit). Also returns every block name found (for --blocks default).
function tagHarnessSections(names) {
  const found = {};
  // metadata + section-metadata are pipeline config, never rendered content.
  const isBlock = (d) => {
    const c = (d.className || '').trim().split(' ')[0];
    return !!c && c !== 'metadata' && c !== 'section-metadata';
  };
  [...document.querySelectorAll('main > div')].forEach((sec) => {
    // Blocks are DIRECT children of the section (the EDS authored shape); keep a
    // single-descendant fallback for a nested one-off. ALL blocks in a section
    // are tagged — a section may hold more than one.
    let blocks = [...sec.querySelectorAll(':scope > div[class]')].filter(isBlock);
    if (!blocks.length) blocks = [...sec.querySelectorAll(':scope div[class]')].filter(isBlock).slice(0, 1);
    blocks.forEach((block) => {
      const name = block.className.split(' ')[0];
      if (names && !names.includes(name)) return;
      // One block in the section → tag the SECTION (default-content siblings the
      // block reabsorbs belong to the round-trip unit); several blocks → tag each
      // block element itself (section-level text can't be attributed to one).
      (found[name] ||= []).push(blocks.length === 1 ? sec : block);
    });
  });
  const counts = {};
  Object.entries(found).forEach(([name, els]) => {
    els.forEach((el, i) => el.setAttribute('data-rt', `${name}-${i}`));
    counts[name] = els.length;
  });
  return counts;
}
/* eslint-enable no-undef */

async function settle(page) {
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 40); }); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
}

async function main() {
  const { proto, content, opts } = parseArgs(process.argv);
  if (!proto || !content) {
    process.stderr.write('usage: node skills/deploy/scripts/block-roundtrip.mjs <prototypeURL> <content/page.html> [--blocks a,b] [--map name=sel] [--styles css] [--blocks-dir dir] [--width px] [--profile p] [--ew|--no-ew] [--json]\n');
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  const rtProf = { ...prof, fontDelta: Infinity }; // structure only — no FONT FORK in the harness

  const stylesPath = opts.styles || firstExisting(['eds/styles/styles.css', 'styles/styles.css'], 'styles.css');
  const blocksDir = opts.blocksDir || firstExisting(['eds/blocks', 'blocks'], 'blocks dir');

  const raw = fs.readFileSync(content, 'utf8');
  const mainMatch = raw.match(/<main>([\s\S]*?)<\/main>/);
  if (!mainMatch) throw new Error(`${content} has no <main> element`);
  const mainHtml = mainMatch[1];
  // metadata + section-metadata are pipeline config, never rendered content —
  // removed in the DOM after setContent (never by regexing the HTML: a lazy regex
  // over-swallows past a shallow/empty metadata block and silently deletes real
  // sections).
  const dropMetadata = () => document.querySelectorAll('main div.metadata, main div.section-metadata').forEach((el) => el.remove());

  const browser = await chromium.launch();
  let failed = false;
  try {
    // ── harness: authored content + foundation/block CSS, decorate locally ──
    const harness = await browser.newPage({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce' });
    const styles = fs.readFileSync(stylesPath, 'utf8');
    // First pass with no block CSS just to discover block names when --blocks omitted.
    await harness.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><main>${mainHtml}</main></body></html>`);
    await harness.evaluate(dropMetadata);
    const discovered = await harness.evaluate(tagHarnessSections, opts.blocks);
    const names = opts.blocks || Object.keys(discovered);
    if (!names.length) throw new Error('no block divs found in the content page');

    const blockCss = names.map((n) => { try { return fs.readFileSync(`${blocksDir}/${n}/${n}.css`, 'utf8'); } catch { return ''; } }).join('\n');
    // body.appear satisfies the vanilla foundation's body{display:none} gate the
    // way loadEager() does — without it every computed-style read sees a hidden page.
    await harness.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main .section{padding:0}${styles}\n${blockCss}</style></head><body class="appear"><main>${mainHtml}</main></body></html>`,
      { waitUntil: 'networkidle' },
    );
    await harness.evaluate(dropMetadata);
    const harnessCounts = await harness.evaluate(tagHarnessSections, names);
    // AFTER tagging (which reads the raw authored shape), mimic the vanilla
    // runtime's decorateButtons/decorateSections/decorateBlock DOM — .section
    // wrappers, .default-content-wrapper, .<name>-wrapper/.block/.<name>-container,
    // AND wrapTextNodes cell normalization (#104: a media-led / unlisted-first-child
    // cell's whole content folds into ONE <p> on live; without mimicking it here
    // a collector that reads cell.children false-passes the gate and drops every
    // sibling after the image in production) — so block/foundation CSS and
    // decode both face the live shape. data-rt tags survive: the tagged
    // elements are moved, not recreated. Shared with the EW probe / render-harness.
    await harness.evaluate(runtimeMimic);
    // --ew: stamp the workspace's instrumentation on the authored (pre-decorate)
    // shape; each text remembers its data-rt unit so survivors are counted per block.
    const ewTexts = opts.ew ? (await harness.evaluate(instrument, EDITABLE)).texts : [];
    const decorateErrs = [];
    // A block whose inlined JS failed to evaluate (module-scope import/export, a
    // syntax error) leaves window.__b[name] undefined — that MUST fail the gate:
    // the undecorated raw rows would match the prototype and exit 0 while the
    // decode was never exercised.
    const notInstalled = await installBlockJs(harness, names, blocksDir);
    notInstalled.forEach((n) => decorateErrs.push(`${n}: block JS failed to install — module-scope import/export or a syntax error (the harness inlines block JS and cannot resolve imports; inline the helper or verify this block via the dev-server harness)`));
    decorateErrs.push(...await runDecorate(harness, names));
    await harness.waitForTimeout(800);
    const ewRows = opts.ew ? await harness.evaluate(survey, ewTexts) : [];
    const exemptions = opts.ew ? readBlockExemptions(blocksDir, names) : {};
    const ewTotals = { authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0 };

    // ── prototype ──
    const protoPage = await browser.newPage({ viewport: { width: opts.width, height: 1000 }, reducedMotion: 'reduce' });
    await protoPage.goto(proto, { waitUntil: 'networkidle', timeout: 60000 });
    await settle(protoPage);
    const protoCounts = await protoPage.evaluate(tagProtoSections, names.map((name) => ({ name, selector: opts.map[name] || null })));

    // ── per-block round-trip ──
    process.stdout.write(`\nBlock round-trip @ ${opts.width}px (profile "${prof.name}", ${blocksDir}, ${stylesPath})\n`);
    if (decorateErrs.length) process.stdout.write(`🔴 decorate errors (these alone fail the gate — an erroring/uninstalled block renders raw rows that can false-match the prototype):\n${decorateErrs.map((e) => `  ${e}`).join('\n')}\n`);
    let totalRed = 0;
    const dump = {};
    for (const name of names) {
      const nProto = protoCounts[name] || 0;
      const nHarness = (harnessCounts[name] || 0);
      if (!nProto) {
        process.stdout.write(`\n■ ${name}: ⚠ no prototype section matched (tried section.${name} / [data-section] / .${name}) — pass --map ${name}=<selector>\n`);
        continue;
      }
      if (nProto !== nHarness) process.stdout.write(`\n■ ${name}: ⚠ instance count differs — ${nProto} prototype section(s) vs ${nHarness} authored block(s)\n`);
      const pairs = Math.min(nProto, nHarness);
      for (let i = 0; i < pairs; i += 1) {
        const srcInv = await protoPage.evaluate(inventory, [`[data-rt="${name}-${i}"]`, prof.eyebrow]);
        const tgtInv = await harness.evaluate(inventory, [`[data-rt="${name}-${i}"]`, prof.eyebrow]);
        const { flags } = diffInventories(srcInv.items, tgtInv.items, rtProf);
        if (srcInv.imgCount !== tgtInv.imgCount) flags.push({ sev: '🟡', kind: 'IMG COUNT', msg: `${prof.source} renders ${srcInv.imgCount} img, ${prof.target} ${tgtInv.imgCount} — a dropped/duplicated <picture>, or an intentional CSS-background/image-slot difference.` });
        // ── Experience Workspace editability (per data-rt unit) ──
        let ew = null;
        if (opts.ew) {
          const unit = `${name}-${i}`;
          ew = aggregate(ewRows.filter((r) => r.unit === unit), { exemptions, keyOf: () => unit }).blocks[0]
            || { authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0, deadItems: [], dupItems: [], exemptItems: [], exemptReasons: [] };
          Object.keys(ewTotals).forEach((k) => { ewTotals[k] += ew[k]; });
          const quote = (d) => `<${d.tag}> "${d.text.slice(0, 48)}${d.text.length > 48 ? '…' : ''}"`;
          ew.deadItems.slice(0, 8).forEach((d) => flags.push({ sev: '🔴', kind: 'DEAD TEXT', msg: `${quote(d)} — rebuilt from textContent/innerHTML, synthesized, or retagged; MOVE the authored element (EW1)` }));
          if (ew.deadItems.length > 8) flags.push({ sev: '🔴', kind: 'DEAD TEXT', msg: `… and ${ew.deadItems.length - 8} more dead text(s) in this block (${ew.dead} of ${ew.authored} authored) — same cause, same fix (EW1)` });
          ew.dupItems.forEach((d) => flags.push({ sev: '🔴', kind: 'DUPLICATED INDEX', msg: `${quote(d)} on ${d.hits} elements — strip instrumentation from presentational clones (EW4)` }));
          if (ew.exemptItems.length) flags.push({ sev: '⚪', kind: 'EXEMPT', msg: `${ew.exemptItems.length} declared non-editable text(s) (${ew.exemptReasons.join('; ')}): ${ew.exemptItems.slice(0, 4).map(quote).join(', ')}${ew.exemptItems.length > 4 ? ', …' : ''} (EW5)` });
        }
        const red = flags.filter((f) => f.sev === '🔴').length;
        totalRed += red;
        const label = pairs > 1 ? `${name}[${i}]` : name;
        process.stdout.write(`\n■ ${label}: ${flags.length ? `${flags.length} finding(s), ${red} structural 🔴` : '✓ round-trip closed'}${ew ? ` — EW editable ${ew.editable}/${ew.authored}, dead ${ew.dead}, duplicated ${ew.duplicated}, exempt ${ew.exempt}` : ''}\n`);
        process.stdout.write(`    ${prof.source}: ${summarise(srcInv)}\n    ${prof.target}: ${summarise(tgtInv)}\n`);
        flags.forEach((f) => process.stdout.write(`  ${f.sev} ${f.kind}: ${f.msg}\n`));
        if (opts.json) dump[label] = { [prof.source]: srcInv, [prof.target]: tgtInv, ...(ew ? { editability: ew } : {}) };
      }
    }
    if (opts.json) process.stdout.write(`\nInventories JSON:\n${JSON.stringify(dump, null, 1)}\n`);
    if (opts.ew) process.stdout.write(`\nEW gate: editable ${ewTotals.editable}/${ewTotals.authored}, dead ${ewTotals.dead}, duplicated ${ewTotals.duplicated}, exempt ${ewTotals.exempt}${ewTotals.dead || ewTotals.duplicated ? ' — dead/duplicated texts are 🔴 above' : ''}\n`);
    const bad = [];
    if (totalRed) bad.push(`${totalRed} structural 🔴`);
    if (decorateErrs.length) bad.push(`${decorateErrs.length} decorate error(s)`);
    process.stdout.write(`\n${bad.length ? `✗ ${bad.join(' + ')} — the round-trip is not closed; fix before deploy.` : '✓ all blocks: round-trip closed (0 structural 🔴).'}\n`);
    failed = bad.length > 0;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 2 : 0);
}

main().catch((e) => { process.stderr.write(`block-roundtrip error: ${e.message}\n`); process.exit(1); });
