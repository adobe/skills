/*
 * Wrap a DA-source body fragment into a full HTML page suitable for
 * local round-trip testing via `aem up --html-folder drafts`.
 *
 * Input — DA-source body fragment, divs-with-class shape:
 *   <body>
 *     <header></header>
 *     <main>
 *       <div>
 *         <div class="blockname">
 *           <div><div>slot-name</div><div>slot-value</div></div>
 *           ...
 *         </div>
 *       </div>
 *       ...
 *       <div>
 *         <div class="metadata">
 *           <div><div>template</div><div>home</div></div>
 *           <div><div>title</div><div>...</div></div>
 *         </div>
 *       </div>
 *     </main>
 *     <footer></footer>
 *   </body>
 *
 * Output — a complete HTML document for `drafts/<page>.html`:
 *   <!DOCTYPE html><html><head>… boilerplate <head> + meta tags from
 *   the metadata block …</head>
 *   <body>… the body fragment, unchanged …</body></html>
 *
 * The output does NOT hardcode a per-template CSS link — the overlay
 * engine in scripts/scripts.js loadCSS()'s /styles/<template>.css
 * dynamically after resolving <meta name="template">.
 *
 * Why this exists: `aem up --html-folder drafts` serves files
 * verbatim. The EDS pipeline that would normally inject `head.html`
 * and lift the metadata block to `<meta>` tags does NOT run for
 * drafts content. This script mimics those pipeline steps so the
 * overlay engine has the same `<meta name="template">` it'd see in
 * production. See experiments/knowledge/learnings.md (2026-05-18
 * entries) for the underlying findings.
 *
 * NOT for production. Production uses DA → EDS pipeline directly.
 *
 * Usage:
 *   node transform-da-to-eds.mjs <da-source.html> <drafts-output.html>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

/**
 * Return the inner content of `<body>…</body>`, or the input
 * unchanged if no body tag is present.
 */
function extractBodyInner(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return m ? m[1] : html;
}

/**
 * Extract the inner content of `<div class="metadata">…</div>` using
 * balanced-div counting. A naive lazy regex breaks because metadata
 * rows like `<div><div>home</div></div>` contain `</div></div>`
 * sequences that look like the block close to a lazy matcher.
 */
function extractMetadataInner(html) {
  const open = '<div class="metadata">';
  const start = html.indexOf(open);
  if (start === -1) return '';
  const innerStart = start + open.length;
  const tagRe = /<\/?div\b[^>]*>/g;
  tagRe.lastIndex = innerStart;
  let depth = 1;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.substring(innerStart, m.index);
    } else {
      depth += 1;
    }
  }
  return '';
}

/**
 * Parse `<div><div>label</div><div>value</div></div>` rows from the
 * metadata block. Values are typically plain text for metadata.
 */
function parseMetadataRows(inner) {
  const out = {};
  const rowRe = /<div>\s*<div>([\s\S]+?)<\/div>\s*<div>([\s\S]+?)<\/div>\s*<\/div>/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = rowRe.exec(inner)) !== null) out[m[1].trim()] = m[2].trim();
  return out;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const [, , inFile, outFile] = argv;
if (!inFile || !outFile) {
  process.stderr.write(
    'Usage: node transform-da-to-eds.mjs <da-source.html> <drafts-output.html>\n',
  );
  process.exit(1);
}

const src = readFileSync(inFile, 'utf8');
const bodyInner = extractBodyInner(src);
const meta = parseMetadataRows(extractMetadataInner(src));

const title = meta.title || 'Untitled';
const metaTags = Object.entries(meta)
  .map(([name, content]) => `  <meta name="${name}" content="${escapeAttr(content)}">`)
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-aem' 'strict-dynamic' 'unsafe-inline' http: https:; base-uri 'self'; object-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
${metaTags}
  <script nonce="aem" src="/scripts/aem.js" type="module"></script>
  <script nonce="aem" src="/scripts/scripts.js" type="module"></script>
  <link rel="stylesheet" href="/styles/styles.css">
</head>
<body>${bodyInner}</body>
</html>
`;

writeFileSync(outFile, html);
process.stdout.write(
  `Wrote ${outFile} (${html.length} bytes, ${Object.keys(meta).length} meta tags)\n`,
);
