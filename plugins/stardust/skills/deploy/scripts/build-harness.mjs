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
 * Usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness>
 *   e.g. node skills/deploy/scripts/build-harness.mjs content/snowflake-blocks/test-12.html qa/test-12.html
 *
 * Output: a full HTML doc loading /styles/styles.css + /scripts/ak.js +
 * /scripts/scripts.js, body = <main> with metadata removed and every absolute
 * .../img/ (or http://localhost:PORT/img/) <img src> rewritten root-relative.
 */
import { readFileSync, writeFileSync } from 'fs';

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

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  process.stderr.write('usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness>\n');
  process.exit(1);
}
let html = readFileSync(inFile, 'utf8');

// 1. extract <main>…</main>
const mm = html.match(/<main[\s\S]*?<\/main>/i);
let main = mm ? mm[0] : html;

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

const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>QA harness</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles/styles.css">
<script src="/scripts/ak.js" type="module"></script>
<script src="/scripts/scripts.js" type="module"></script>
<link rel="icon" href="/favicon.svg"><link rel="icon" href="/favicon.ico"></head>
<body>
${main}
</body></html>`;
writeFileSync(outFile, doc);
process.stdout.write(`harness written: ${outFile} (${doc.length} bytes)\n`);
