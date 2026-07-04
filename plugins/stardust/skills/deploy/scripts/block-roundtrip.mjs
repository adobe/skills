#!/usr/bin/env node
/**
 * block-roundtrip.mjs — in-loop per-block ENCODE→DECODE round-trip assertion (#94).
 *
 * Step 10's content-diff proves fidelity AFTER deploy — too late to be the place
 * where defects are FOUND. This gate runs at block-authoring time, per block,
 * with no DA and no dev server (the render-harness technique): it decorates the
 * authored content locally with the block's own JS+CSS, extracts the role
 * inventory from the decorated section AND from the matching prototype section
 * (the SAME classifier as content-diff — skills/diff/scripts/content-inventory.mjs),
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
 *     --json             dump per-block inventories
 *
 * Exit codes: 0 = round-trip closed (no structural 🔴, no decorate errors),
 * 2 = structural 🔴 found OR a block's decorate() failed to install/run (a block
 * that cannot be decorated must never pass — its raw rows would match the
 * prototype and green-light a decode that was never exercised), 1 = tool error.
 *
 * Limitation: block JS is INLINED into the harness page, so module-scope
 * `import` statements cannot be resolved — such a block FAILS the gate loudly
 * (inline the helper, or verify that block via the dev-server harness + Step 10).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import fs from 'fs';
import { resolveProfile } from '../../diff/scripts/diff-profiles.mjs';
import { inventory, diffInventories, summarise } from '../../diff/scripts/content-inventory.mjs';

function parseArgs(argv) {
  const [, , proto, content, ...rest] = argv;
  const opts = { blocks: null, map: {}, styles: null, blocksDir: null, width: 1280, profile: 'eds', json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--blocks') { opts.blocks = rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--map') { const [k, ...v] = rest[i += 1].split('='); opts.map[k] = v.join('='); }
    else if (a === '--styles') { opts.styles = rest[i += 1]; }
    else if (a === '--blocks-dir') { opts.blocksDir = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
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
    process.stderr.write('usage: node skills/deploy/scripts/block-roundtrip.mjs <prototypeURL> <content/page.html> [--blocks a,b] [--map name=sel] [--styles css] [--blocks-dir dir] [--width px] [--profile p] [--json]\n');
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
    await harness.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main .section{padding:0}${styles}\n${blockCss}</style></head><body><main>${mainHtml}</main></body></html>`,
      { waitUntil: 'networkidle' },
    );
    await harness.evaluate(dropMetadata);
    const harnessCounts = await harness.evaluate(tagHarnessSections, names);
    const decorateErrs = [];
    const withJs = [];
    for (const name of names) {
      let js;
      try { js = fs.readFileSync(`${blocksDir}/${name}/${name}.js`, 'utf8'); } catch { continue; } // CSS-only block: nothing to decode
      withJs.push(name);
      await harness.addScriptTag({ content: `window.__b=window.__b||{};window.__b[${JSON.stringify(name)}]=(function(){${js.replace(/export default\s+/, '')}\nreturn decorate;})();` });
    }
    // A block whose inlined JS failed to evaluate (module-scope import/export, a
    // syntax error) leaves window.__b[name] undefined — that MUST fail the gate:
    // the undecorated raw rows would match the prototype and exit 0 while the
    // decode was never exercised.
    const notInstalled = await harness.evaluate((ns) => ns.filter((n) => !(window.__b && window.__b[n])), withJs);
    notInstalled.forEach((n) => decorateErrs.push(`${n}: block JS failed to install — module-scope import/export or a syntax error (the harness inlines block JS and cannot resolve imports; inline the helper or verify this block via the dev-server harness)`));
    const errs = await harness.evaluate(async (ns) => {
      const out = [];
      for (const n of ns) {
        if (!window.__b || !window.__b[n]) continue;
        for (const el of document.querySelectorAll(`.${n}`)) {
          try { await window.__b[n](el); } catch (e) { out.push(`${n}: ${e.message}`); }
        }
      }
      return out;
    }, names);
    decorateErrs.push(...errs);
    await harness.waitForTimeout(800);

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
        const red = flags.filter((f) => f.sev === '🔴').length;
        totalRed += red;
        const label = pairs > 1 ? `${name}[${i}]` : name;
        process.stdout.write(`\n■ ${label}: ${flags.length ? `${flags.length} finding(s), ${red} structural 🔴` : '✓ round-trip closed'}\n`);
        process.stdout.write(`    ${prof.source}: ${summarise(srcInv)}\n    ${prof.target}: ${summarise(tgtInv)}\n`);
        flags.forEach((f) => process.stdout.write(`  ${f.sev} ${f.kind}: ${f.msg}\n`));
        if (opts.json) dump[label] = { [prof.source]: srcInv, [prof.target]: tgtInv };
      }
    }
    if (opts.json) process.stdout.write(`\nInventories JSON:\n${JSON.stringify(dump, null, 1)}\n`);
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
