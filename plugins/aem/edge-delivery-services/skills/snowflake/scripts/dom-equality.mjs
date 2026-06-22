#!/usr/bin/env node
/**
 * dom-equality.mjs — verify the converted overlay page is 1:1 with the source.
 *
 * Loads both pages via playwright-cli, waits for the overlay engine to apply
 * on the rendered page, then compares:
 *   - Element count under <scope> (default: <main>)
 *   - Tag+class sequence (positional; first divergence reported with context)
 *   - Visible text (whitespace-normalised; byte-identical or not)
 *   - Image src list (Media Bus rewrites — `./media_<sha>.<ext>` — are
 *     normalised as expected, not flagged as regressions)
 *
 * Writes a markdown report to --report. Exit 0 on PASS, 1 on FAIL.
 *
 * Usage:
 *   node dom-equality.mjs \
 *     --source        <url>       # original source page
 *     --rendered      <url>       # converted overlay page (local or prod)
 *     --report        <path>      # output markdown report
 *     [--scope        <selector>] # comparison root for both pages (default: main)
 *     [--source-scope <selector>] # override comparison root on the source side
 *                                 # (use this when the source has no <main>;
 *                                 # typical override: --source-scope body)
 *     [--rendered-scope <selector>]
 *                                 # override comparison root on the rendered side
 *     [--timeout      <seconds>]  # wait-for-overlay timeout (default: 10)
 *     [--no-wait-overlay]         # don't wait for main.dataset.overlay on rendered
 *
 * Exit codes: 0 pass, 1 fail (diffs found), 2 setup error.
 *
 * Asymmetric scope:
 *   The converter often SYNTHESIZES a <main> the source lacks. When the
 *   source's <body> has nav + sections + footer at the top level and the
 *   rendered page has nav as <header> + main(sections) + <footer>,
 *   comparing <main> on both sides counts only sections on the rendered
 *   side but degrades to <body> on the source (different scope).
 *
 *   Recommended invocation in that case:
 *     --source-scope body --rendered-scope body
 *
 *   …and accept that wrapper-element diffs (the nav-wrap vs. <header>
 *   wrapper, etc.) will show as divergences. The report's per-section
 *   text comparison still tells you whether the CONTENT is intact.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Arg parsing (no deps — single-pass)
// ---------------------------------------------------------------------------

const args = { scope: 'main', timeout: '10' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'no-wait-overlay') args[key] = true;
    else args[key] = process.argv[++i];
  }
}

const SOURCE = args.source;
const RENDERED = args.rendered;
const REPORT = args.report;
const SOURCE_SCOPE = args['source-scope'] || args.scope;
const RENDERED_SCOPE = args['rendered-scope'] || args.scope;
const TIMEOUT_MS = Number(args.timeout) * 1000;
const WAIT_OVERLAY = !args['no-wait-overlay'];

const die = (msg, code = 2) => { console.error(`[dom-equality] ${msg}`); process.exit(code); };

if (!SOURCE) die('--source <url> required');
if (!RENDERED) die('--rendered <url> required');
if (!REPORT) die('--report <path> required');

// ---------------------------------------------------------------------------
// playwright-cli wrapper
// ---------------------------------------------------------------------------

const SESSION_SOURCE = `dom-eq-src-${process.pid}`;
const SESSION_RENDERED = `dom-eq-rnd-${process.pid}`;

function pwc(session, ...args) {
  const r = spawnSync('playwright-cli', [`-s=${session}`, ...args], { encoding: 'utf8' });
  if (r.error) die(`playwright-cli not on PATH: ${r.error.message}`);
  if (r.status !== 0) die(`playwright-cli ${args[0]} failed (exit ${r.status}):\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Extract the "### Result\n<json>" block from a playwright-cli stdout. */
function parseEvalOutput(out) {
  const idx = out.indexOf('### Result');
  if (idx < 0) return null;
  // Lines after "### Result" up to next "###" header
  const rest = out.slice(idx + '### Result'.length).split(/^###\s/m)[0].trim();
  try { return JSON.parse(rest); }
  catch { return rest; } // raw string if not JSON
}

function evalJS(session, fn) {
  const out = pwc(session, 'eval', fn);
  return parseEvalOutput(out);
}

// ---------------------------------------------------------------------------
// Capture script — runs in the page, returns the comparison data
// ---------------------------------------------------------------------------

const captureFn = (scope, waitOverlay, timeoutMs) => `async () => {
  if (${waitOverlay}) {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() < deadline) {
      const main = document.querySelector('main');
      if (main && main.dataset && main.dataset.overlay) break;
      await new Promise(r => setTimeout(r, 100));
    }
  } else {
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }
    // small settle for async DOM work
    await new Promise(r => setTimeout(r, 500));
  }
  const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
  const elements = Array.from(root.querySelectorAll('*'));
  return {
    scope: ${JSON.stringify(scope)},
    elementCount: elements.length,
    tagSequence: elements.map(e => {
      const tag = e.tagName.toLowerCase();
      const cls = (typeof e.className === 'string' && e.className.trim())
        ? '.' + e.className.trim().split(/\\s+/)[0]
        : '';
      return tag + cls;
    }),
    visibleText: ((root.innerText || '').replace(/\\s+/g, ' ').trim()),
    imageSrcs: Array.from(root.querySelectorAll('img')).map(img => img.getAttribute('src') || ''),
  };
}`;

// ---------------------------------------------------------------------------
// Capture both pages
// ---------------------------------------------------------------------------

let srcData, rndData;
try {
  console.error(`[dom-equality] capturing source: ${SOURCE} (scope: ${SOURCE_SCOPE})`);
  pwc(SESSION_SOURCE, 'open', SOURCE);
  srcData = evalJS(SESSION_SOURCE, captureFn(SOURCE_SCOPE, false, TIMEOUT_MS));
  pwc(SESSION_SOURCE, 'close');

  console.error(`[dom-equality] capturing rendered: ${RENDERED} (scope: ${RENDERED_SCOPE})`);
  pwc(SESSION_RENDERED, 'open', RENDERED);
  rndData = evalJS(SESSION_RENDERED, captureFn(RENDERED_SCOPE, WAIT_OVERLAY, TIMEOUT_MS));
  pwc(SESSION_RENDERED, 'close');
} catch (e) {
  // Best-effort cleanup
  try { pwc(SESSION_SOURCE, 'close'); } catch { /* ignore */ }
  try { pwc(SESSION_RENDERED, 'close'); } catch { /* ignore */ }
  throw e;
}

if (!srcData || typeof srcData !== 'object') die(`could not capture source DOM (got: ${JSON.stringify(srcData)})`);
if (!rndData || typeof rndData !== 'object') die(`could not capture rendered DOM (got: ${JSON.stringify(rndData)})`);

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const diffs = [];

// 1) Element count
const countMatch = srcData.elementCount === rndData.elementCount;
if (!countMatch) {
  diffs.push({
    field: 'elementCount',
    source: srcData.elementCount,
    rendered: rndData.elementCount,
    delta: rndData.elementCount - srcData.elementCount,
  });
}

// 2) Tag+class sequence — positional, first divergence wins
const srcTags = srcData.tagSequence;
const rndTags = rndData.tagSequence;
let firstDivergence = -1;
const minLen = Math.min(srcTags.length, rndTags.length);
for (let i = 0; i < minLen; i++) {
  if (srcTags[i] !== rndTags[i]) { firstDivergence = i; break; }
}
if (firstDivergence === -1 && srcTags.length !== rndTags.length) {
  firstDivergence = minLen;
}
const sequenceMatch = firstDivergence === -1;
if (!sequenceMatch) {
  const ctxStart = Math.max(0, firstDivergence - 2);
  const ctxEnd = firstDivergence + 3;
  diffs.push({
    field: 'tagSequence',
    position: firstDivergence,
    sourceContext: srcTags.slice(ctxStart, ctxEnd),
    renderedContext: rndTags.slice(ctxStart, ctxEnd),
    ctxStart,
  });
}

// 3) Visible text — whitespace-normalised
const textMatch = srcData.visibleText === rndData.visibleText;
if (!textMatch) {
  // Find first divergent character for hint
  let firstChar = -1;
  const minCharLen = Math.min(srcData.visibleText.length, rndData.visibleText.length);
  for (let i = 0; i < minCharLen; i++) {
    if (srcData.visibleText[i] !== rndData.visibleText[i]) { firstChar = i; break; }
  }
  if (firstChar === -1) firstChar = minCharLen;
  diffs.push({
    field: 'visibleText',
    sourceLen: srcData.visibleText.length,
    renderedLen: rndData.visibleText.length,
    firstDivergentChar: firstChar,
    sourceSnippet: srcData.visibleText.slice(Math.max(0, firstChar - 30), firstChar + 50),
    renderedSnippet: rndData.visibleText.slice(Math.max(0, firstChar - 30), firstChar + 50),
  });
}

// 4) Image srcs — Media Bus rewrites are EXPECTED, not regressions
const mediaBusRe = /(^|\/)media_[0-9a-f]+\.[a-z0-9]+(\?|$)/i;
const isMediaBusRewrite = (rendered, source) =>
  mediaBusRe.test(rendered) && source && !source.startsWith('./media_') && !source.startsWith('/media_');
const imgDiffs = [];
if (srcData.imageSrcs.length !== rndData.imageSrcs.length) {
  imgDiffs.push({
    type: 'count',
    source: srcData.imageSrcs.length,
    rendered: rndData.imageSrcs.length,
  });
} else {
  for (let i = 0; i < srcData.imageSrcs.length; i++) {
    const s = srcData.imageSrcs[i];
    const r = rndData.imageSrcs[i];
    if (s === r) continue;
    if (isMediaBusRewrite(r, s)) continue;
    imgDiffs.push({ type: 'mismatch', index: i, source: s, rendered: r });
  }
}
const imageMatch = imgDiffs.length === 0;
if (!imageMatch) diffs.push({ field: 'imageSrcs', details: imgDiffs });

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

const pass = diffs.length === 0;
const tick = (b) => b ? '✓' : '✗';

let md = `# DOM equality report\n\n`;
md += `- **Source URL:**     ${SOURCE}\n`;
md += `- **Rendered URL:**   ${RENDERED}\n`;
md += `- **Source scope:**   \`${SOURCE_SCOPE}\`${SOURCE_SCOPE !== RENDERED_SCOPE ? ' (asymmetric)' : ''}\n`;
md += `- **Rendered scope:** \`${RENDERED_SCOPE}\`\n`;
md += `- **Generated:**      ${new Date().toISOString()}\n\n`;

md += `## Summary\n\n`;
md += `| Field                 | Source                  | Rendered                | Status |\n`;
md += `|-----------------------|-------------------------|-------------------------|--------|\n`;
md += `| Element count         | ${srcData.elementCount.toString().padEnd(23)} | ${rndData.elementCount.toString().padEnd(23)} | ${tick(countMatch)}      |\n`;
md += `| Tag+class sequence    | ${srcTags.length.toString().padEnd(23)} | ${rndTags.length.toString().padEnd(23)} | ${tick(sequenceMatch)}      |\n`;
md += `| Visible text (chars)  | ${srcData.visibleText.length.toString().padEnd(23)} | ${rndData.visibleText.length.toString().padEnd(23)} | ${tick(textMatch)}      |\n`;
md += `| Image refs            | ${srcData.imageSrcs.length.toString().padEnd(23)} | ${rndData.imageSrcs.length.toString().padEnd(23)} | ${tick(imageMatch)}      |\n\n`;

md += `**Overall:** ${pass ? '**PASS**' : '**FAIL**'}\n\n`;

if (!pass) {
  md += `## Differences\n\n`;
  for (const d of diffs) {
    md += `### ${d.field}\n\n`;
    if (d.field === 'elementCount') {
      md += `Source has ${d.source}, rendered has ${d.rendered} (delta: ${d.delta >= 0 ? '+' : ''}${d.delta}).\n\n`;
    } else if (d.field === 'tagSequence') {
      md += `First divergence at position ${d.position}.\n\n`;
      md += `\`\`\`diff\n`;
      d.sourceContext.forEach((t, i) => {
        const lineNum = d.ctxStart + i;
        const marker = lineNum === d.position ? '-' : ' ';
        md += `${marker} [${lineNum}] ${t}\n`;
      });
      md += `---\n`;
      d.renderedContext.forEach((t, i) => {
        const lineNum = d.ctxStart + i;
        const marker = lineNum === d.position ? '+' : ' ';
        md += `${marker} [${lineNum}] ${t}\n`;
      });
      md += `\`\`\`\n\n`;
    } else if (d.field === 'visibleText') {
      md += `Source: ${d.sourceLen} chars, rendered: ${d.renderedLen} chars. First divergent character at position ${d.firstDivergentChar}.\n\n`;
      md += `Source context:\n\n> ${d.sourceSnippet.replace(/\n/g, ' ')}\n\n`;
      md += `Rendered context:\n\n> ${d.renderedSnippet.replace(/\n/g, ' ')}\n\n`;
    } else if (d.field === 'imageSrcs') {
      md += `${d.details.length} unexpected difference(s):\n\n`;
      d.details.slice(0, 20).forEach((x) => {
        if (x.type === 'count') {
          md += `- Image count differs: source=${x.source}, rendered=${x.rendered}\n`;
        } else {
          md += `- [${x.index}] source=\`${x.source}\` rendered=\`${x.rendered}\`\n`;
        }
      });
      if (d.details.length > 20) md += `- … (${d.details.length - 20} more)\n`;
      md += `\n*Media Bus rewrites (\`./media_<sha>.<ext>?...\`) are not counted as differences.*\n\n`;
    }
  }
}

// ---------------------------------------------------------------------------
// Write report + exit
// ---------------------------------------------------------------------------

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, md);
console.error(`[dom-equality] report written to ${REPORT}`);
console.error(`[dom-equality] overall: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
