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
 * Two things the delivery pipeline does server-side that a local harness gets
 * from nobody (nothing runs in front of the raw authored HTML here):
 *   section-metadata fold — a current scripts/aem.js no longer folds
 *     `section-metadata` client-side; the pipeline does (helix-html-pipeline,
 *     src/steps/extract-section-metadata.js). Left in the DOM the block is
 *     decorated as an unknown block and the section never gets its `style`
 *     classes: styled sections render as the plain variant and every probe
 *     against the harness lies. Mirrored here: `style` → classes on the
 *     section div, `id` → the section id, any other key → `data-<key>`, the
 *     block removed (authored source has no wrapper div around it).
 *   media remap — editorial images authored as
 *     https://content.da.live/<org>/<repo>/media/<scope>/<file> do not load
 *     anonymously (that host answers 401), so probes see broken images and
 *     clientWidth 0. With a media ledger (what da-media-upload.mjs writes)
 *     every entry's contentUrl is replaced by the root-relative path of the
 *     captured local file.
 *
 * Usage: node skills/deploy/scripts/build-harness.mjs <contentFile> <outHarness>
 *          [--root <dir>] [--media-ledger <json>]
 *   e.g. node skills/deploy/scripts/build-harness.mjs content/<path>.html \
 *          stardust/.work/harness/page.html
 *   --root <dir>           repo root the harness is served from: favicon
 *                          detection, ledger auto-detect, root-relative media
 *                          paths (default: cwd)
 *   --media-ledger <json>  media ledger to remap from (default: auto-detect
 *                          <root>/stardust/deploy/media-ledger.json when it
 *                          exists — unreadable → WARN, no remap; given
 *                          explicitly but missing/invalid → exit 1)
 *
 * Prints (stdout): `N section-metadata block(s) folded`, `N image URL(s)
 * remapped to captured files`, `harness written: <outHarness> (<n> bytes)`.
 * WARN (stderr): a section-metadata block without key/value rows or not a
 * direct child of a section (left in place), an unreadable auto-detected
 * ledger, a captured file outside <root> or missing, an orphan </div>.
 * Writes: <outHarness> only (its parent directory must already exist).
 * Output: a full HTML doc loading /styles/styles.css + /scripts/scripts.js
 * (which imports aem.js, adds body.appear, and loads the sections — the same
 * boot as head.html), body = empty <header>/<footer> (the runtime's
 * loadHeader/loadFooter need the elements to exist, and loadLazy would die
 * before loading any section if <header> is missing) + <main> with metadata
 * removed, section-metadata folded, ledger image URLs remapped, and every
 * absolute .../img/ (or http://localhost:PORT/img/) <img src> rewritten
 * root-relative.
 * The favicon link derives from what actually shipped (deploy Step 3
 * § Favicon is format-preserving — favicon.<ext>): exactly ONE link,
 * mirroring the icon href in <root>/head.html when present (that line is
 * what shipped), else the repo-root favicon.{ico,svg,png} that exists, or
 * `href="data:,"` when none does — zero favicon requests either way (probe
 * determinism, no guaranteed 404 per load).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  isAbsolute, join, relative, sep,
} from 'path';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const CLOSE = '</div>'.length;
const warn = (msg) => process.stderr.write(`WARN: ${msg}\n`);

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

// Spans [start, end) of the <div> elements that are direct children of the element whose
// content is s[from, to) — the same balanced walk, jumping over each child's subtree.
function childDivs(s, from, to) {
  const out = [];
  const re = /<div\b/gi;
  re.lastIndex = from;
  for (let m = re.exec(s); m && m.index < to; m = re.exec(s)) {
    const end = matchDivEnd(s, m.index);
    if (end > to) break;
    out.push([m.index, end]);
    re.lastIndex = end;
  }
  return out;
}
const openTagEnd = (s, at) => s.indexOf('>', at) + 1;
const openTag = (s, at) => s.slice(at, openTagEnd(s, at));
const innerOf = (s, [start, end]) => s.slice(openTagEnd(s, start), end - CLOSE);
const classesOf = (tag) => ((tag.match(/(?:^|\s)class=(["'])(.*?)\1/i) || [])[2] || '')
  .split(/\s+/).filter(Boolean);

// ---- section-metadata fold — mirrors helix-html-pipeline src/steps/extract-section-metadata.js
// (rendering v2, sites created ≥ 2026-05). For every `div.section-metadata` that is a direct
// child of a section div, each row `<div><div>key</div><div>value</div></div>` (a row with
// fewer than two cells is ignored) is applied to the SECTION — the block's parent node:
//   key   → toMetaName: every char outside [0-9a-zA-Z:_-] becomes `-`, then lowercase
//   style → getStyleClassNames: each text run (tag boundaries such as <br>/<p> separate runs)
//           split on `,`, each part through toBlockCSSClassNames — a trailing `(a, b)` group
//           adds options, lowercase, runs outside [0-9a-z] → `-`, edge `-` trimmed — and the
//           names are APPENDED to the section's existing class list
//   id    → toSectionId: lowercase, runs outside [0-9a-z._:-] → `-`, leading non-letters and
//           trailing `-` stripped; empty → not set
//   other → data-<key> = getValueFromNode: <img src> / <a href> contribute the URL (a link's
//           own text is skipped), text runs contribute their comma-split trimmed tokens; all
//           joined by `,`; a later row with the same key overwrites
// then `parent.children.splice(index, 1)`: the block node alone is removed. There is no wrapper
// to remove — a `section-metadata-wrapper` div is a client-side decorateSections artefact that
// never exists in authored source, which is what the pipeline (and this script) reads.
// Deviations, both moot for DA-authored cells: key text is whitespace-trimmed (DA normalises
// cell whitespace before the pipeline sees it) and relative img/a URLs stay as authored (the
// pipeline absolutises them against the site origin, which a harness does not have).
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const textOf = (h) => decode(h.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function toMetaName(text) {
  const name = text.replace(/[^0-9a-zA-Z:_-]/g, '-');
  const lower = name.toLowerCase();
  if (lower.startsWith('hreflang-') || lower.startsWith('hreflang:')) {
    return `hreflang:${name.substring(9)}`;
  }
  return lower;
}
function toBlockCSSClassNames(text) {
  if (!text) return [];
  const idx = text.lastIndexOf('(');
  const names = idx >= 0 ? [text.substring(0, idx), ...text.substring(idx + 1).split(',')] : [text];
  return names
    .map((n) => n.toLowerCase().replace(/[^0-9a-z]+/g, '-').replace(/^-+/, '').replace(/-+$/, ''))
    .filter(Boolean);
}
const toSectionId = (text) => (text || '').toLowerCase().replace(/[^0-9a-z._:-]+/g, '-')
  .replace(/^[^a-z]+/, '').replace(/-+$/, '');
const styleClassNames = (h) => decode(h.replace(/<[^>]*>/g, ',')).split(',')
  .flatMap(toBlockCSSClassNames);
function valueOf(h) {
  const items = [];
  let inLink = false;
  for (const tok of h.match(/<[^>]*>|[^<]+/g) || []) {
    if (tok[0] !== '<') {
      if (!inLink) items.push(...decode(tok).split(',').map((t) => t.trim()).filter(Boolean));
    } else if (inLink) {
      if (/^<\/a\s*>/i.test(tok)) inLink = false;
    } else if (/^<img\b/i.test(tok)) {
      const src = tok.match(/\ssrc=(["'])(.*?)\1/i);
      if (src) items.push(decode(src[2]));
    } else if (/^<a\b/i.test(tok)) {
      const href = tok.match(/\shref=(["'])(.*?)\1/i);
      if (href) { items.push(decode(href[2])); inLink = true; }
    }
  }
  return items.join(',');
}

// [key, valueHtml] pairs of one section-metadata block whose content is s[from, to).
function readRows(s, from, to) {
  const pairs = [];
  for (const row of childDivs(s, from, to)) {
    const cells = childDivs(s, openTagEnd(s, row[0]), row[1] - CLOSE);
    if (cells.length >= 2) {
      const key = toMetaName(textOf(innerOf(s, cells[0])));
      if (key) pairs.push([key, innerOf(s, cells[1])]);
    }
  }
  return pairs;
}
// The section's opening tag with the pairs applied (classes appended, attributes set/overwritten).
function applyPairs(tag, pairs) {
  const classes = [];
  const attrs = new Map();
  for (const [key, valueHtml] of pairs) {
    if (key === 'style') {
      classes.push(...styleClassNames(valueHtml));
    } else if (key === 'id') {
      const id = toSectionId(textOf(valueHtml));
      if (id) attrs.set('id', id);
    } else {
      attrs.set(`data-${key}`, valueOf(valueHtml));
    }
  }
  let t = tag;
  const add = (attr) => t.replace(/\s*\/?>$/, ` ${attr}>`);
  if (classes.length) {
    const m = t.match(/\sclass=(["'])(.*?)\1/i);
    const all = m ? [...m[2].trim().split(/\s+/), ...classes] : classes;
    const attr = `class="${all.filter(Boolean).join(' ')}"`;
    t = m ? t.replace(m[0], ` ${attr}`) : add(attr);
  }
  for (const [name, value] of attrs) {
    const re = new RegExp(`\\s${name}=(["']).*?\\1`, 'i');
    const attr = `${name}="${escapeAttr(value)}"`;
    t = re.test(t) ? t.replace(re, ` ${attr}`) : add(attr);
  }
  return t;
}
// Fold every direct-child section-metadata block of every top-level section, last to first so
// earlier offsets stay valid. Returns the new main plus how many folded / were left in place.
function foldSectionMetadata(main) {
  let s = main;
  const open = s.match(/<main[^>]*>/i);
  const sections = childDivs(s, open ? open.index + open[0].length : 0, s.length);
  let folded = 0;
  let left = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const [start, end] = sections[i];
    const tagEnd = openTagEnd(s, start);
    let tag = openTag(s, start);
    let body = s.slice(tagEnd, end - CLOSE);
    const blocks = childDivs(s, tagEnd, end - CLOSE)
      .filter(([b]) => classesOf(openTag(s, b)).includes('section-metadata'));
    for (let j = blocks.length - 1; j >= 0; j--) {
      const [b, bEnd] = blocks[j];
      const pairs = readRows(s, openTagEnd(s, b), bEnd - CLOSE);
      if (pairs.length) {
        tag = applyPairs(tag, pairs);
        body = body.slice(0, b - tagEnd) + body.slice(bEnd - tagEnd);
        folded++;
      } else {
        left++;
        warn(`section ${i + 1} of ${sections.length}: section-metadata block has no key/value rows`
          + ' — left in place.');
      }
    }
    s = s.slice(0, start) + tag + body + s.slice(end - CLOSE);
  }
  return { html: s, folded, left };
}

const argv = process.argv.slice(2);
let root = process.cwd();
let ledgerPath = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = argv[++i];
  else if (argv[i] === '--media-ledger') ledgerPath = argv[++i];
  else pos.push(argv[i]);
}
const [inFile, outFile] = pos;
if (!inFile || !outFile || root === undefined || ledgerPath === undefined) {
  process.stderr.write('usage: node skills/deploy/scripts/build-harness.mjs <contentFile>'
    + ' <outHarness> [--root <dir>] [--media-ledger <json>]\n');
  process.exit(1);
}

// Media ledger: explicit path must load; the auto-detected default may be absent (no editorial
// images were uploaded) or unreadable (WARN — the harness is still worth building).
const explicitLedger = ledgerPath !== null;
if (!explicitLedger) {
  const auto = join(root, 'stardust', 'deploy', 'media-ledger.json');
  if (existsSync(auto)) ledgerPath = auto;
}
let ledger = null;
if (ledgerPath) {
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
      throw new Error('not a JSON object');
    }
  } catch (e) {
    if (explicitLedger) {
      process.stderr.write(`media ledger ${ledgerPath}: ${e.message}\n`);
      process.exit(1);
    }
    warn(`media ledger ${ledgerPath} unreadable (${e.message}) — image URLs not remapped.`);
    ledger = null;
  }
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

// 3. fold section-metadata blocks into their sections the way the pipeline does (see above)
const fold = foldSectionMetadata(main);
main = fold.folded ? fold.html.replace(/\n\s*\n/g, '\n') : fold.html;
process.stdout.write(`${fold.folded} section-metadata block(s) folded\n`);
const SM_TAG = /<div\b[^>]*\sclass=["'](?:[^"']*\s)?section-metadata(?:\s[^"']*)?["']/gi;
const nested = (main.match(SM_TAG) || []).length - fold.left;
if (nested > 0) {
  warn(`${nested} section-metadata block(s) not a direct child of a top-level section`
    + ' — left in place.');
}

// 4. remap every ledger contentUrl to its captured file, root-relative. Longest URL first so a
// URL that prefixes another (…/a.jpg vs …/a.jpg.png) never clips it.
let remapped = 0;
let remapNote = ledgerPath ? '' : ' (no media ledger)';
if (ledger) {
  const entries = Object.values(ledger)
    .filter((e) => e && typeof e.contentUrl === 'string' && e.contentUrl)
    .filter((e) => typeof e.file === 'string' && e.file)
    .sort((a, b) => b.contentUrl.length - a.contentUrl.length);
  for (const e of entries) {
    const hits = main.split(e.contentUrl).length - 1;
    if (hits) {
      const rel = (isAbsolute(e.file) ? relative(root, e.file) : e.file)
        .split(sep).join('/').replace(/^(\.\/)+/, '');
      if (rel === '..' || rel.startsWith('../')) {
        warn(`ledger file ${e.file} is not under ${root} — ${e.contentUrl} left as is.`);
      } else {
        if (!existsSync(join(root, rel))) {
          warn(`captured file /${rel} missing under ${root} — remapped anyway.`);
        }
        main = main.split(e.contentUrl).join(`/${rel}`);
        remapped += hits;
      }
    }
  }
} else if (ledgerPath) remapNote = ' (ledger unreadable)';
process.stdout.write(`${remapped} image URL(s) remapped to captured files${remapNote}\n`);

// 5. rewrite absolute image origins to root-relative /img/ so committed assets load
main = main
  .replace(/https?:\/\/[^"')\s]*?\/img\//gi, '/img/')
  .replace(/http:\/\/localhost:\d+\/img\//gi, '/img/');

// 6. sanity: no orphan leading close tag
const lead = main.replace(/<main[^>]*>/i, '').trimStart();
if (lead.startsWith('</div>')) {
  process.stderr.write('WARN: harness <main> starts with an orphan </div> — metadata strip mis-balanced.\n');
}

// 7. favicon: emit ONE link matching the favicon that actually shipped.
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
<link rel="stylesheet" href="/styles/styles.css">
<script src="/scripts/scripts.js" type="module"></script>
${faviconLink}</head>
<body>
<header></header>
${main}
<footer></footer>
</body></html>`;
writeFileSync(outFile, doc);
process.stdout.write(`harness written: ${outFile} (${doc.length} bytes)\n`);
