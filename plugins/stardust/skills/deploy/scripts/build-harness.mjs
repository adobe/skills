#!/usr/bin/env node
/* eslint-disable no-plusplus */
/**
 * skills/deploy/scripts/build-harness.mjs — build a local QA harness from a DA content page.
 *
 * The Step-10 visual-diff harness needs the content page's <main> with the
 * metadata block removed and absolute image URLs made local. Hand-rolling that
 * strip with a regex is fragile (the metadata block is nested div-in-div, so a
 * naive `…</div></div>` match stops a tag too early and leaves an orphan </div>
 * that corrupts the harness DOM — #46). This does it with balanced tag counting.
 *
 * Usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness> [--root <dir>] [--no-pipeline] [--style-split comma|first-only]
 *   e.g. node skills/deploy/scripts/build-harness.mjs content/snowflake-blocks/test-12.html stardust/.work/harness/test-12.html
 *   --root <dir>       repo root the harness is served from (favicon detection;
 *                      default: cwd)
 *   --no-pipeline      skip the pipeline emulation (pure A/B against the old harness)
 *   --style-split      section-metadata `style` split: comma (D7 default) | first-only
 *
 * Pipeline emulation (pipeline-mimic.mjs) runs FIRST on the extracted <main>:
 * section-metadata → classes/data-*, <img> → <p><picture>, sole-emphasis links
 * hoisted, NBSP paragraphs dropped, `:icon:` → span, raw tables → block divs,
 * attribute strip — the delivered shape, so the real scripts.js decorates what
 * the preview host will serve. The page `metadata` rows become <meta name>
 * tags in <head> (the real aem.js decorateTemplateAndTheme reads
 * getMetadata('template'|'theme'); the header block reads 'nav'). The rule
 * counts are printed once per run. Exit 0 = written, 1 = usage.
 *
 * Output: a full HTML doc loading /styles/styles.css + /scripts/scripts.js
 * (which imports aem.js, adds body.appear, and loads the sections — the same
 * boot as head.html), body = empty <header>/<footer> (the runtime's
 * loadHeader/loadFooter need the elements to exist, and loadLazy would die
 * before loading any section if <header> is missing) + <main> with metadata
 * removed and every absolute .../img/ (or http://localhost:PORT/img/)
 * <img src> rewritten root-relative.
 * The favicon link derives from what actually shipped (deploy Step 3
 * § Favicon is format-preserving — favicon.<ext>): exactly ONE link,
 * mirroring the icon href in <root>/head.html when present (that line is
 * what shipped), else the repo-root favicon.{ico,svg,png} that exists, or
 * `href="data:,"` when none does — zero favicon requests either way (probe
 * determinism, no guaranteed 404 per load).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pipelineMimic, formatCounts, metaTags } from './pipeline-mimic.mjs';

// Return the index just past the </div> that closes the <div> starting at `start`.
function matchDivEnd(s, start) {
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  let depth = 0;
  let m = re.exec(s);
  while (m) {
    if (m[0][1] === '/') { depth--; if (depth === 0) return m.index + m[0].length; } else depth++;
    m = re.exec(s);
  }
  return s.length;
}

const argv = process.argv.slice(2);
let root = process.cwd();
let pipeline = true;
let styleSplit = 'comma';
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = argv[++i];
  else if (argv[i] === '--no-pipeline') pipeline = false;
  else if (argv[i] === '--style-split') styleSplit = argv[++i];
  else if (argv[i] === '--help' || argv[i] === '-h') { process.stdout.write('usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness> [--root <dir>] [--no-pipeline] [--style-split comma|first-only]\n'); process.exit(0); }
  else pos.push(argv[i]);
}
const [inFile, outFile] = pos;
if (!inFile || !outFile || !['comma', 'first-only'].includes(styleSplit)) {
  process.stderr.write('usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness> [--root <dir>] [--no-pipeline] [--style-split comma|first-only]\n');
  process.exit(1);
}
let html = readFileSync(inFile, 'utf8');

// 1. extract <main>…</main>
const mm = html.match(/<main[\s\S]*?<\/main>/i);
let main = mm ? mm[0] : html;

// 1b. pipeline emulation — the delivered shape (section-metadata applied, pictures,
// hoists, whitespace, tables, icons, attribute strip); the metadata rows come back
// as `meta` for the <head>. Stage one below (#46 balanced strip) stays as the
// fallback for --no-pipeline.
let meta = {};
let countsLine = 'pipeline emulation: off (--no-pipeline)';
if (pipeline) {
  const r = pipelineMimic(main, { styleSplit });
  main = r.html; meta = r.meta; countsLine = formatCounts(r.counts);
}

// 2. remove the metadata section: the wrapper <div> two levels above class="metadata"
const metaAttr = main.indexOf('class="metadata"');
if (metaAttr >= 0) {
  const metaDiv = main.lastIndexOf('<div', metaAttr);
  const wrapDiv = main.lastIndexOf('<div', metaDiv - 1);
  const end = matchDivEnd(main, wrapDiv);
  main = (main.slice(0, wrapDiv) + main.slice(end)).replace(/\n\s*\n/g, '\n');
}

// 3. rewrite absolute image origins to root-relative /img/ so committed assets load
main = main
  .replace(/https?:\/\/[^"')\s]*?\/img\//gi, '/img/')
  .replace(/http:\/\/localhost:\d+\/img\//gi, '/img/');

// 4. sanity: no orphan leading close tag
const lead = main.replace(/<main[^>]*>/i, '').trimStart();
if (lead.startsWith('</div>')) {
  process.stderr.write('WARN: harness <main> starts with an orphan </div> — metadata strip mis-balanced.\n');
}

// 5. favicon: emit ONE link matching the favicon that actually shipped.
// Authority order: (a) the icon link deploy Step 3 § Favicon wrote into
// <root>/head.html — that href IS what ships, so mirror it (a bare
// existence probe would link a stale boilerplate favicon.ico even when the
// deploy shipped favicon.svg/png alongside it); (b) no head.html icon link →
// file existence, ico first (an ico-only site has no head.html line by
// design — /favicon.ico is the browser default); (c) nothing → the data:
// no-op keeps the harness at zero favicon requests (probe determinism, no
// guaranteed 404 per load).
let faviconLink = null;
const headFile = join(root, 'head.html');
if (existsSync(headFile)) {
  const head = readFileSync(headFile, 'utf8');
  const iconTag = (head.match(/<link\b[^>]*>/gi) || []).find((t) => /\brel=["'][^"']*icon[^"']*["']/i.test(t));
  const href = iconTag && iconTag.match(/\bhref=["']([^"']+)["']/i);
  if (href) faviconLink = `<link rel="icon" href="${href[1]}">`;
}
if (!faviconLink) {
  const faviconExt = ['ico', 'svg', 'png'].find((e) => existsSync(join(root, `favicon.${e}`)));
  faviconLink = faviconExt ? `<link rel="icon" href="/favicon.${faviconExt}">` : '<link rel="icon" href="data:,">';
}

const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>QA harness</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${metaTags(meta)}
<link rel="stylesheet" href="/styles/styles.css">
<script src="/scripts/scripts.js" type="module"></script>
${faviconLink}</head>
<body>
<header></header>
${main}
<footer></footer>
</body></html>`;
writeFileSync(outFile, doc);
process.stdout.write(`harness written: ${outFile} (${doc.length} bytes) — ${countsLine}${meta.template || meta.theme ? ` — <meta> template=${meta.template || '-'} theme=${meta.theme || '-'}` : ''}\n`);
