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
 *     --no-pipeline       skip the pipeline emulation (pipeline-mimic.mjs runs on the
 *                         authored <main> BEFORE setContent, so tagging, instrumentation
 *                         and runtimeMimic all see the delivered shape; the page
 *                         metadata's template/theme become body classes as
 *                         decorateTemplateAndTheme would; counts printed once per run)
 *     --style-split       comma (D7 default) | first-only — section-metadata `style` split
 *     --root <dir>        repo root the block imports resolve against (default: the
 *                         blocks dir's parent). The harness page has a synthetic origin
 *                         served from this root (ew-editability-probe.mjs openHarness), so
 *                         block JS installs as a REAL module — aem.js, project helpers and
 *                         sibling-block imports resolve; an unresolvable specifier 404s and
 *                         the block is reported as not installed. Other origins are aborted
 *                         and listed.
 *     --fragments <dir>   serve `/x.plain.html` from `<dir>/x.html` (its <main>, through the
 *                         pipeline emulation) so loadFragment()-driven blocks and per-page
 *                         `nav:`/`footer:` chrome render from local content (default: content/
 *                         when it exists; the dev-server harness still cannot do this)
 *     --strict            with --ew: exit 1 when a used @ew-exempt is block-granular without
 *                         `all` or names no category (item-level syntax in the probe header)
 *
 * Exit codes: 0 rendered (and, with --ew, no dead/duplicated text), 1 = --ew found
 * dead non-exempt text or a duplicated index (or a --strict exemption finding),
 * 2 = harness error.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  EDITABLE, firstExisting, readMainHtml, dropMetadata, discoverBlocks, runtimeMimic, instrument, survey, simulateEditor,
  openHarness, installBlockJs, installErrors, runDecorate, readBlockExemptions, aggregate, formatTable, formatRequests, verdict, strictFindings, fetchQuickEditCss,
} from './ew-editability-probe.mjs';
import { pipelineMimic, formatCounts, bodyClasses } from './pipeline-mimic.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { positional: [], styles: null, blocksDir: null, root: null, fragments: undefined, strict: false, width: 1280, ew: false, simulate: false, pipeline: true, styleSplit: 'comma' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--styles') { opts.styles = rest[i += 1]; }
    else if (a === '--blocks-dir') { opts.blocksDir = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--ew') { opts.ew = true; }
    else if (a === '--simulate-editor') { opts.simulate = true; opts.ew = true; }
    else if (a === '--no-pipeline') { opts.pipeline = false; }
    else if (a === '--style-split') { opts.styleSplit = rest[i += 1]; }
    else if (a === '--root') { opts.root = rest[i += 1]; }
    else if (a === '--fragments') { opts.fragments = rest[i += 1]; }
    else if (a === '--strict') { opts.strict = true; opts.ew = true; }
    else if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a.startsWith('--')) { throw new Error(`unknown option ${a}`); }
    else opts.positional.push(a);
  }
  const [contentPath, out, ...blocks] = opts.positional;
  return { contentPath, out, blocks, opts };
}

async function main() {
  const { contentPath, out, blocks, opts } = parseArgs(process.argv);
  const usage = 'usage: node render-harness.mjs <content/path.html> <out.png> [block-name ...] [--styles css] [--blocks-dir dir] [--root dir] [--fragments dir] [--width px] [--ew] [--strict] [--simulate-editor] [--no-pipeline] [--style-split comma|first-only]\n';
  if (opts.help) { process.stdout.write(usage); process.exit(0); }
  if (!contentPath || !out || !['comma', 'first-only'].includes(opts.styleSplit)) {
    process.stderr.write(usage);
    process.exit(2);
  }
  const stylesPath = opts.styles || firstExisting(['eds/styles/styles.css', 'styles/styles.css'], 'styles.css');
  const blocksDir = opts.blocksDir || firstExisting(['eds/blocks', 'blocks'], 'blocks dir');
  let mainHtml = readMainHtml(contentPath);
  const bodyCls = ['appear'];
  if (opts.pipeline) {
    // Delivered shape first: what the preview host serves is what decode faces.
    const r = pipelineMimic(mainHtml, { styleSplit: opts.styleSplit });
    mainHtml = r.html;
    bodyCls.push(...bodyClasses(r.meta));
    console.log(formatCounts(r.counts));
  }
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const root = opts.root || path.dirname(path.resolve(blocksDir));
  const fragments = opts.fragments === undefined ? (fs.existsSync('content') ? 'content' : null) : opts.fragments;

  const b = await chromium.launch();
  let fail = false;
  try {
    // body.appear satisfies the stock body{display:none} gate the same way
    // loadEager() does; body > header hidden (sticky headers in tall screenshots).
    // The page lives on the harness origin served from `root` (real module imports).
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}body > header{display:none}main .section{padding:0}${styles}</style></head><body class="${bodyCls.join(' ')}"><main>${mainHtml}</main></body></html>`;
    const h = await openHarness(b, { html, root, width: opts.width, height: 900, fragments, transformFragment: opts.pipeline ? (frag) => pipelineMimic(frag, { styleSplit: opts.styleSplit }).html : null });
    const p = h.page;
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
    const notInstalled = await installBlockJs(p, names, blocksDir, { root: h.root });
    errs.push(...installErrors(notInstalled, h.requests, h.root));
    errs.push(...await runDecorate(p, names));
    await p.waitForTimeout(1200);
    let agg = null; let sim = null; let strict = [];
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
      strict = opts.strict ? strictFindings(agg) : [];
      fail = v.dead || v.duplicated || strict.length > 0;
    }
    await p.screenshot({ path: out, fullPage: true });
    console.log('rendered', out, opts.simulate ? '(simulated edit mode)' : '', `| root ${h.root}${fragments ? `, fragments ${fragments}` : ''} | block errors:`, JSON.stringify(errs));
    if (agg) console.log(formatTable(`EW editability — ${contentPath}`, agg, { sim, verbose: true, errors: [], requests: h.requests, strict }));
    else console.log(formatRequests(h.requests).join('\n'));
  } finally {
    await b.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { process.stderr.write(`render-harness error: ${e.message}\n`); process.exit(2); });
