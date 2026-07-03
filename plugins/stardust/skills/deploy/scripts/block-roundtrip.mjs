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
 * Exit codes: 0 = round-trip closed (no structural 🔴), 2 = structural 🔴 found, 1 = error.
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
  [...document.querySelectorAll('main > div')].forEach((sec) => {
    const cands = [...sec.querySelectorAll(':scope > div[class]'), ...sec.querySelectorAll(':scope div[class]')];
    const block = cands.find((d) => d.className.trim() && d.className.split(' ')[0] !== 'metadata');
    if (!block) return;
    const name = block.className.split(' ')[0];
    if (names && !names.includes(name)) return;
    (found[name] ||= []).push(sec);
  });
  const counts = {};
  Object.entries(found).forEach(([name, secs]) => {
    secs.forEach((sec, i) => sec.setAttribute('data-rt', `${name}-${i}`));
    counts[name] = secs.length;
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
  const mainHtml = mainMatch[1]
    .replace(/<div class="metadata">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, ''); // drop metadata block

  const browser = await chromium.launch();
  let failed = false;
  try {
    // ── harness: authored content + foundation/block CSS, decorate locally ──
    const harness = await browser.newPage({ viewport: { width: opts.width, height: 1000 } });
    const styles = fs.readFileSync(stylesPath, 'utf8');
    // First pass with no block CSS just to discover block names when --blocks omitted.
    await harness.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><main>${mainHtml}</main></body></html>`);
    const discovered = await harness.evaluate(tagHarnessSections, opts.blocks);
    const names = opts.blocks || Object.keys(discovered);
    if (!names.length) throw new Error('no block divs found in the content page');

    const blockCss = names.map((n) => { try { return fs.readFileSync(`${blocksDir}/${n}/${n}.css`, 'utf8'); } catch { return ''; } }).join('\n');
    await harness.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main .section{padding:0}${styles}\n${blockCss}</style></head><body><main>${mainHtml}</main></body></html>`,
      { waitUntil: 'networkidle' },
    );
    const harnessCounts = await harness.evaluate(tagHarnessSections, names);
    const decorateErrs = [];
    for (const name of names) {
      let js;
      try { js = fs.readFileSync(`${blocksDir}/${name}/${name}.js`, 'utf8'); } catch { continue; } // CSS-only block: nothing to decode
      await harness.addScriptTag({ content: `window.__b=window.__b||{};window.__b[${JSON.stringify(name)}]=(function(){${js.replace(/export default\s+/, '')}\nreturn decorate;})();` });
    }
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
    const protoPage = await browser.newPage({ viewport: { width: opts.width, height: 1000 } });
    await protoPage.goto(proto, { waitUntil: 'networkidle', timeout: 60000 });
    await settle(protoPage);
    const protoCounts = await protoPage.evaluate(tagProtoSections, names.map((name) => ({ name, selector: opts.map[name] || null })));

    // ── per-block round-trip ──
    process.stdout.write(`\nBlock round-trip @ ${opts.width}px (profile "${prof.name}", ${blocksDir}, ${stylesPath})\n`);
    if (decorateErrs.length) process.stdout.write(`⚠ decorate() errors (fix first — an erroring block renders raw rows):\n${decorateErrs.map((e) => `  ${e}`).join('\n')}\n`);
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
    process.stdout.write(`\n${totalRed ? `✗ ${totalRed} structural 🔴 — the decode does not close the round-trip; fix before deploy.` : '✓ all blocks: round-trip closed (0 structural 🔴).'}\n`);
    failed = totalRed > 0;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 2 : 0);
}

main().catch((e) => { process.stderr.write(`block-roundtrip error: ${e.message}\n`); process.exit(1); });
