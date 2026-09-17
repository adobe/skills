#!/usr/bin/env node
/**
 * render-harness.mjs — reproduce EDS block decoration locally (no DA / dev-server).
 *
 * Injects styles.css + each block's CSS, mimics the vanilla runtime's
 * decorateButtons/decorateSections/decorateBlock/wrapTextNodes DOM, runs every
 * block's decorate() over the authored content, and screenshots — so first-pass
 * conversion fidelity is verifiable even when DA_TOKEN is expired (fidelity is
 * decided at conversion time, not deploy time). `body > header` is hidden in the
 * harness CSS: sticky headers land in tall element screenshots.
 *
 * Usage:
 *   node render-harness.mjs <content/path.html> <out.png> [block-name ...] [options]
 *     block-name ...      blocks to decorate (default: every block div found in the page)
 *     --styles <path>     foundation CSS (default eds/styles/styles.css, then styles/styles.css)
 *     --blocks-dir <dir>  blocks root (default eds/blocks, then blocks)
 *     --width <px>        viewport width (default 1280)
 *     --ew                Experience Workspace editability: stamp `data-prose-index`
 *                         on the authored texts before decorate() and print the
 *                         survivor table (dead / duplicated / exempt per block —
 *                         see ew-editability-probe.mjs; `@ew-exempt` JSDoc tags read
 *                         from the blocks dir). Exit 1 when a non-exempt text is dead
 *                         or an index is duplicated.
 *     --simulate-editor   after decorate(), swap every surviving text for the
 *                         ProseMirror-shaped editor the canvas inserts, so the
 *                         screenshot shows EDIT MODE (implies --ew instrumentation;
 *                         the quick-edit CSS fetch degrades gracefully offline)
 *
 * Exit codes: 0 rendered (and, with --ew, no dead/duplicated text), 1 = --ew found
 * dead non-exempt text or a duplicated index, 2 = harness error.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  EDITABLE, firstExisting, readMainHtml, dropMetadata, discoverBlocks, runtimeMimic, instrument, survey, simulateEditor,
  installBlockJs, runDecorate, readBlockExemptions, aggregate, formatTable, verdict, fetchQuickEditCss,
} from './ew-editability-probe.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { positional: [], styles: null, blocksDir: null, width: 1280, ew: false, simulate: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--styles') { opts.styles = rest[i += 1]; }
    else if (a === '--blocks-dir') { opts.blocksDir = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--ew') { opts.ew = true; }
    else if (a === '--simulate-editor') { opts.simulate = true; opts.ew = true; }
    else if (a.startsWith('--')) { throw new Error(`unknown option ${a}`); }
    else opts.positional.push(a);
  }
  const [contentPath, out, ...blocks] = opts.positional;
  return { contentPath, out, blocks, opts };
}

async function main() {
  const { contentPath, out, blocks, opts } = parseArgs(process.argv);
  if (!contentPath || !out) {
    process.stderr.write('usage: node render-harness.mjs <content/path.html> <out.png> [block-name ...] [--styles css] [--blocks-dir dir] [--width px] [--ew] [--simulate-editor]\n');
    process.exit(2);
  }
  const stylesPath = opts.styles || firstExisting(['eds/styles/styles.css', 'styles/styles.css'], 'styles.css');
  const blocksDir = opts.blocksDir || firstExisting(['eds/blocks', 'blocks'], 'blocks dir');
  const mainHtml = readMainHtml(contentPath);
  const styles = fs.readFileSync(stylesPath, 'utf8');

  const b = await chromium.launch();
  let fail = false;
  try {
    const p = await b.newPage({ viewport: { width: opts.width, height: 900 }, reducedMotion: 'reduce' });
    // body.appear satisfies the stock body{display:none} gate the same way
    // loadEager() does; body > header hidden (sticky headers in tall screenshots).
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}body > header{display:none}main .section{padding:0}${styles}</style></head><body class="appear"><main>${mainHtml}</main></body></html>`, { waitUntil: 'networkidle' });
    await p.evaluate(dropMetadata);
    const names = blocks.length ? blocks : await p.evaluate(discoverBlocks);
    const blockCss = names.map((n) => { try { return fs.readFileSync(path.join(blocksDir, n, `${n}.css`), 'utf8'); } catch { return ''; } }).join('\n');
    if (blockCss) await p.addStyleTag({ content: blockCss });
    // Mimic the vanilla runtime's decorateMain DOM (aem.js): .section +
    // .default-content-wrapper + .<name>-wrapper/.block/.<name>-container +
    // wrapTextNodes cell normalization (#104 — media-led cells fold into one <p>
    // on live; the harness must present the same shape to decode). Without this,
    // block CSS scoped to the decorated shape silently never matches in the harness.
    await p.evaluate(runtimeMimic);
    const texts = opts.ew ? (await p.evaluate(instrument, EDITABLE)).texts : [];
    const errs = [];
    const notInstalled = await installBlockJs(p, names, blocksDir);
    notInstalled.forEach((n) => errs.push(`${n}: block JS failed to install (module-scope import/export or syntax error)`));
    errs.push(...await runDecorate(p, names));
    await p.waitForTimeout(1200);
    let agg = null; let sim = null;
    if (opts.ew) {
      const rows = await p.evaluate(survey, texts);
      if (opts.simulate) {
        const css = await fetchQuickEditCss();
        if (css) await p.addStyleTag({ content: css });
        sim = await p.evaluate(simulateEditor, texts);
        await p.waitForTimeout(300);
      }
      agg = aggregate(rows, { sim, exemptions: readBlockExemptions(blocksDir, names) });
      const v = verdict(agg);
      fail = v.dead || v.duplicated;
    }
    await p.screenshot({ path: out, fullPage: true });
    console.log('rendered', out, opts.simulate ? '(simulated edit mode)' : '', '| block errors:', JSON.stringify(errs));
    if (agg) console.log(formatTable(`EW editability — ${contentPath}`, agg, { sim, verbose: true, errors: [] }));
  } finally {
    await b.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { process.stderr.write(`render-harness error: ${e.message}\n`); process.exit(2); });
