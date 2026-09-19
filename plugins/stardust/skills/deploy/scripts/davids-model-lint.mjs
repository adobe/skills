#!/usr/bin/env node
/**
 * skills/deploy/scripts/davids-model-lint.mjs — David's Model conformance gate
 * for generated EDS/DA content pages (see ../davids-model.md for the rules).
 *
 * Why this exists: the ENCODE contract lived in prose, and first-pass runs
 * drifted from it (over-blocked prose, name/value display copy, code-as-text)
 * until an explicit "follow David's Model" second pass fixed the structure.
 * This makes conformance mechanical: it runs in the per-page atomic delivery
 * contract BEFORE sanitise/PUT, and a page with any 🔴 must not be written.
 *
 *   node skills/deploy/scripts/davids-model-lint.mjs content/            # tree
 *   node skills/deploy/scripts/davids-model-lint.mjs content/index.html  # one page
 *   … [--json] [--source-host <host[,host]> [--content-root content]]
 *
 * --source-host enables the D4 LOCALIZE advisory: an <a href> to the live
 * source host whose path exists in the content tree (--content-root, default:
 * the first directory argument) is a bounce link — it sends visitors back to
 * the old site for a page that exists on the new origin. Advisory (🟡) in this
 * release; the fix is `localize-links.mjs` (the pipeline stage), not a hand edit.
 *
 * Exit codes: 0 = clean (🟡 advisories allowed — review, fix or justify in the
 * conversion log), 2 = at least one 🔴, 1 = usage/parse failure.
 *
 * 🔴 (block the write)                      🟡 (advisory)
 *   D1  wrapper block around default content   D1  block section with no repeating
 *   D1  embed/video URL authored as a block        structure (default-content candidate)
 *   D2  block table nested inside a block cell D3  ragged rows (cell-count mismatch —
 *   D4  relative/repo-relative src or href         a span-shaped structure)
 *   D4  protocol-relative or delivery branch-host
 *       <a href> (//host/p, main--repo--org.aem.page)
 *                                            D4  source-host href whose path exists
 *                                                locally (LOCALIZE — run localize-links)
 *   D14 display copy in a key-value block     D10 block rows wider than 4 columns
 *   D15 code visible as text (tags/{{}}/CSS/   D5  complex nested list inside a cell
 *       inline-script text: window./try {)     D15 ALL_CAPS_TOKEN — tracking-token
 *                                                  lookalike (advisory: legit acronyms exist)
 *   HR  authored <hr> (#119 — the section delimiter; fractures the section)
 *   TABLE raw <table> under <main> (the pipeline names a block after its
 *       first cell → a `table` block whose CSS 404s; author the `table` block)
 *                                            D6  SOLE-EMPH — a lone link wrapped by
 *                                                emphasis in the pipeline-hoisted order
 *                                                (<a><strong>, <b>/<i>, or in a <li>)
 *                                                buttonizes on delivery
 *                                            META ALONE — a section whose only child is
 *                                                the metadata block (empty band)
 *                                            META CHROME — metadata block in /nav,
 *                                                /footer or /fragments/*
 *                                            HBR heading text carrying <br> (stripped)
 *                                            D15 TEXT-LEAK — [sup]/[sub] tokens,
 *                                                label^tooltip carets, ||| runs
 *                                            D15 JSON — raw `json-ld` metadata row /
 *                                                value cell starting with { or [
 *                                                (JSON-LD is composed at runtime, D10)
 *                                            TEXT punctuation-only <p>; >50 % of
 *                                                in-block <img> with alt=""
 *                                            CHROME header/footer/nav/page-chrome block
 *                                                inlined into a content document
 *                                            D12 CONTENT — a /fragments/ target in this
 *                                                tree carrying > 60 prose words (inline it
 *                                                + re-sync row; fragments cost strict pts)
 *
 * Dependency-free by design (regex + balanced-div walking, same technique as
 * build-harness.mjs) — content pages are machine-generated and regular; this
 * is a structural lint, not a browser-grade parser.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';

const WRAPPER_BLOCK_NAMES = new Set(['text', 'heading', 'title', 'image']);
const KEY_VALUE_BLOCKS = new Set(['metadata', 'section-metadata']);
const CHROME_BLOCK_NAMES = new Set(['header', 'footer', 'nav', 'page-chrome']);
const EMBED_HOST = /(youtube\.com|youtu\.be|vimeo\.com|player\.|\/embed\/)/i;
// Default-content-expressible tags: what a prose section can carry natively.
const PROSE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'picture', 'img', 'source', 'strong', 'em', 'code', 'br']);

// ---------------------------------------------------------------- primitives

// Index just past the </div> closing the <div> that starts at `start`.
function matchDivEnd(s, start) {
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  let depth = 0;
  let m = re.exec(s);
  while (m) {
    if (m[0][1] === '/') { depth -= 1; if (depth === 0) return m.index + m[0].length; } else depth += 1;
    m = re.exec(s);
  }
  return s.length;
}

// Direct child <div>s of the container whose inner HTML is `inner`.
function childDivs(inner) {
  const out = [];
  const re = /<div\b[^>]*>/gi;
  let m = re.exec(inner);
  while (m) {
    const end = matchDivEnd(inner, m.index);
    out.push({
      openTag: m[0],
      outer: inner.slice(m.index, end),
      inner: inner.slice(m.index + m[0].length, end - '</div>'.length),
      start: m.index,
    });
    re.lastIndex = end;
    m = re.exec(inner);
  }
  return out;
}

function classOf(openTag) {
  const m = openTag.match(/class="([^"]*)"/i);
  return m ? m[1].trim() : '';
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagsIn(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)].map((m) => m[1].toLowerCase());
}

// ------------------------------------------------------------------- checks

function lintPage(file, html, findings) {
  const flag = (sev, rule, msg) => findings.push({ sev, rule, file, msg });

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const main = mainMatch ? mainMatch[1] : html; // nav/footer docs may be bare fragments
  const sections = childDivs(main);

  for (const section of sections) {
    const kids = childDivs(section.inner);
    const defaultContentText = stripTags(childlessHtml(section.inner, kids));

    for (const block of kids) {
      const cls = classOf(block.openTag);
      if (!cls) continue; // an unclassed child div is a stray wrapper, not a block
      const name = cls.split(/\s+/)[0].toLowerCase();
      lintBlock(file, section, block, name, flag);
    }

    lintSectionShape(file, section, kids, defaultContentText, flag);
  }

  lintPipelineShapes(file, main, sections, flag);

  lintText(file, main, flag);
  lintAlts(file, sections, flag);
  lintUrls(file, main, flag);

  // HR (#119) — <hr> is the EDS section delimiter: authored inside a section
  // it silently fractures that section into several at ingestion, and every
  // downstream section selector/style breaks. Visual rules are drawn in CSS
  // (an empty section with a section-metadata style value + a border).
  const hrs = [...main.matchAll(/<hr\b/gi)].length;
  if (hrs) {
    flag('🔴', 'HR', `${hrs} authored <hr> element(s) — <hr> is the section delimiter and fractures the section at ingestion; author an empty styled section and draw the rule in CSS (#119)`);
  }
}

// HTML of a container minus its direct child divs (the default-content part).
function childlessHtml(inner, kids) {
  let out = '';
  let cursor = 0;
  for (const k of kids) {
    out += inner.slice(cursor, k.start);
    cursor = k.start + k.outer.length;
  }
  return out + inner.slice(cursor);
}

function lintBlock(file, section, block, name, flag) {
  const rows = childDivs(block.inner);
  const label = `section ${classOf(section.openTag) || '(unnamed)'} → block "${name}"`;

  // D1 — wrapper block around bare default content.
  if (WRAPPER_BLOCK_NAMES.has(name)) {
    flag('🔴', 'D1', `${label}: block named "${name}" wraps bare default content — author it as default content in the section instead`);
  }

  // CHROME — nav/footer inlined into a content document is an owner decision
  // (David's Model #8 authoring groups, #12 fragments), never the default.
  if (CHROME_BLOCK_NAMES.has(name) && !CHROME_PATH.test(file)) {
    flag('🟡', 'CHROME', `${label}: chrome block "${name}" inlined into a content document — an owner decision recorded in direction.md (or stardust/decisions.md)? Default is the runtime fragment (reference/ai-readability.md § 5)`);
  }

  const isKeyValue = KEY_VALUE_BLOCKS.has(name);
  const cellCounts = [];

  rows.forEach((row, ri) => {
    const cells = childDivs(row.inner);
    cellCounts.push(cells.length);

    cells.forEach((cell, ci) => {
      const where = `${label} row ${ri + 1} cell ${ci + 1}`;

      // D2 — a block-shaped classed <div> inside a cell = nested block table.
      for (const nested of childDivs(cell.inner)) {
        if (classOf(nested.openTag)) {
          flag('🔴', 'D2', `${where}: nested block table "${classOf(nested.openTag)}" inside a cell — use a fragment link or auto-blocking`);
        }
      }

      // D1 — embed/video URL authored as block content.
      if (!isKeyValue) {
        const links = [...cell.inner.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
        const text = stripTags(cell.inner);
        if (links.length === 1 && EMBED_HOST.test(links[0][1]) && text === stripTags(links[0][2])) {
          flag('🔴', 'D1', `${where}: embed/video URL authored inside a block — author it as a plain link in default content and auto-block it in scripts.js buildAutoBlocks()`);
        }
      }

      // D5 — complex nested list inside a cell (list items carrying headings /
      // multiple paragraphs belong one-per-row, not in a nested list).
      const liComplex = /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*<(?:h[1-6]|p)\b[\s\S]*?<\/li>/i;
      if (liComplex.test(cell.inner)) {
        flag('🟡', 'D5', `${where}: nested list whose items carry headings/paragraphs — model as one block row per item`);
      }
    });

    // D14 — display copy in a key-value block's value cell.
    if (isKeyValue && cells.length >= 2) {
      const valueTags = tagsIn(cells[1].inner);
      const pCount = valueTags.filter((t) => t === 'p').length;
      if (valueTags.some((t) => /^h[1-6]$/.test(t) || t === 'picture') || pCount > 1) {
        flag('🔴', 'D14', `${label} row ${ri + 1}: key-value block carries display content (heading/picture/multi-paragraph) in its value cell — name/value is for configuration only`);
      }
      // D15 JSON — a raw `json-ld` row is pipeline-supported but is JSON in a
      // document; the documented default composes JSON-LD at runtime (D10).
      const key = stripTags(cells[0].inner).toLowerCase();
      const val = stripTags(cells[1].inner);
      if (/json-?ld|^schema$/.test(key) || /^[{[]/.test(val)) {
        flag('🟡', 'D15', `${label} row ${ri + 1}: raw JSON in a metadata row ("${key}") — JSON-LD is composed at runtime by scripts.js from the page-type and typed metadata rows (reference/content-page-scaffold.md § 9); a raw json-ld row is a per-page exception, not the default`);
      }
    }
  });

  // D10 — column budget.
  const maxCols = Math.max(0, ...cellCounts);
  if (maxCols > 4) {
    flag('🟡', 'D10', `${label}: ${maxCols} columns — >4 usually means fragmented content (exception: a genuine data table)`);
  }

  // D3 — ragged rows (span-shaped structure). The block-name "header" concept
  // doesn't exist in div-table content, so every row should agree.
  const distinct = [...new Set(cellCounts.filter((n) => n > 0))];
  if (distinct.length > 1) {
    flag('🟡', 'D3', `${label}: rows have differing cell counts (${distinct.join(', ')}) — span-shaped structure; align rows or split the block`);
  }

  // D1 — over-blocking advisory: a lone single-column block whose every cell is
  // prose-expressible and which has no repeating structure reads as default
  // content wearing a table. (Advisory: bespoke widgets legitimately look
  // like this — template-slotted heroes, countdowns.)
  if (!isKeyValue && rows.length > 0 && rows.length <= 3 && maxCols <= 1) {
    const allProse = rows.every((row) => {
      const cells = childDivs(row.inner);
      const htmlIn = cells.length ? cells.map((c) => c.inner).join('') : row.inner;
      return tagsIn(htmlIn).every((t) => PROSE_TAGS.has(t));
    });
    if (allProse) {
      flag('🟡', 'D1', `${label}: single-column, ${rows.length}-row block holding only prose elements — default-content candidate (justify in the conversion log if it is a genuine bespoke widget)`);
    }
  }
}

function lintSectionShape(file, section, kids, defaultContentText, flag) {
  // META ALONE — the metadata block is consumed into <head>; a section holding
  // nothing else delivers as an empty padded band (first or trailing).
  if (kids.length === 1 && classOf(kids[0].openTag).split(/\s+/)[0].toLowerCase() === 'metadata' && !defaultContentText) {
    flag('🟡', 'META', 'metadata block alone in its section — put it in the section that holds the first content (an empty band ships otherwise; `main .section:empty` is only a fallback)');
  }
}

// Shapes the DA → EDS pipeline rewrites on delivery, invisible in the harness
// (reference/encode-contract.md § Pipeline-sensitive shapes).
const CHROME_PATH = /(^|[\\/])(nav|footer)\.html$|[\\/]fragments[\\/]/i;
const capped = (arr, n = 5) => (arr.length <= n ? arr : arr.slice(0, n));
function lintPipelineShapes(file, main, sections, flag) {
  // TABLE 🔴 — a raw <table> is a block named after its first cell.
  const tables = [...main.matchAll(/<table\b/gi)].length;
  if (tables) {
    flag('🔴', 'TABLE', `${tables} raw <table> element(s) — the pipeline turns a table into a block named after its first cell (its CSS 404s); author the \`table\` block (\`no-header\` variant) instead`);
  }
  // META CHROME 🟡 — chrome/fragment documents carry no metadata block.
  if (CHROME_PATH.test(file) && sections.some((s) => childDivs(s.inner).some((k) => classOf(k.openTag).split(/\s+/)[0].toLowerCase() === 'metadata'))) {
    flag('🟡', 'META', 'metadata block in a chrome/fragment document — /nav, /footer and /fragments/* carry none (an empty band shifts the slot contract); noindex via the metadata sheet or robots');
  }
  // HBR 🟡 — <br> inside a heading is stripped at delivery.
  const hbr = [...main.matchAll(/<h[1-6]\b[^>]*>(?:(?!<\/h[1-6]>)[\s\S])*?<br\b/gi)];
  if (hbr.length) {
    flag('🟡', 'HBR', `${hbr.length} heading(s) carry <br> — the pipeline strips layout breaks inside headings; let the heading wrap, or size the block's heading width in CSS`);
  }
  // D6 SOLE-EMPH 🟡 — buttonization is decided from the SOURCE shape: a link
  // that is a paragraph/list-item/cell's sole content buttonizes when emphasis
  // wraps it in EITHER nesting order (<a><strong> is hoisted to <strong><a>;
  // <b>/<i> are emitted as <strong>/<em>), and a lone <strong><a> in a <li>
  // buttonizes too. <p><strong><a> is the intended D6 shape and is not flagged.
  const A = '<a\\b[^>]*>[^<]*<\\/a>';
  const inner = new RegExp(`<(p|li|div)\\b[^>]*>\\s*<a\\b[^>]*>\\s*<(strong|em|b|i)\\b[^>]*>[^<]*<\\/\\2>\\s*<\\/a>\\s*<\\/\\1>`, 'gi');
  const bi = new RegExp(`<(p|li|div)\\b[^>]*>\\s*<(b|i)\\b[^>]*>\\s*${A}\\s*<\\/\\2>\\s*<\\/\\1>`, 'gi');
  const li = new RegExp(`<li\\b[^>]*>\\s*<(strong|em)\\b[^>]*>\\s*${A}\\s*<\\/\\1>\\s*<\\/li>`, 'gi');
  const hits = [...main.matchAll(inner), ...main.matchAll(bi), ...main.matchAll(li)].map((m) => stripTags(m[0]).slice(0, 40));
  if (hits.length) {
    flag('🟡', 'D6', `${hits.length} lone emphasised link(s) in the pipeline-hoisted shape (<a><strong>, <b>/<i>, or alone in a <li>) will buttonize on delivery — emit a plain link and restore the weight in block CSS, or author the D6 <p><strong><a> shape on purpose: ${capped(hits).map((h) => `"${h}"`).join(', ')}${hits.length > 5 ? ` (+${hits.length - 5} more)` : ''}`);
  }
}

function lintText(file, main, flag) {
  // D15 — code visible as text. In raw content HTML, author-visible "<tag>"
  // is entity-encoded, and template/binding syntax survives literally.
  const text = stripTags(main);
  const m = text.match(/&(?:lt|#x0*3c|#0*60);\s*[a-z][a-z0-9-]*|\{\{[^}]*\}\}|<%|%>|\b[a-z-]+\s*:\s*[^;{}]+;\s*\}/i);
  if (m) {
    flag('🔴', 'D15', `code visible as text in authored content ("${m[0].slice(0, 40)}…") — markup/bindings/CSS never appear as author-facing text`);
  }
  // D15 — INLINE-SCRIPT text lifted as copy. A live-DOM scraper that reads
  // textContent picks up analytics/`<script>` bodies ("try { window.X.wcm… }")
  // and renders them as body paragraphs — a D15 violation the importer itself
  // created, and it silently displaces real copy when a keep-first-N cap runs.
  const js = text.match(/\bwindow\.[A-Za-z_$][\w$]*|\btry\s*\{|\bdocument\.(?:querySelector|getElementById|cookie|write)\b|\bfunction\s*\(|=>\s*\{/);
  if (js) {
    flag('🔴', 'D15', `inline-script text visible as content ("${js[0].slice(0, 40)}…") — a scraper lifted <script> text as copy; filter code artifacts at capture time`);
  }
  // D15 advisory — ALL_CAPS_WITH_UNDERSCORE tokens read like campaign/tracking
  // identifiers ("SPOFFCAR_PARTNER"). Advisory only: legitimate acronyms and
  // product codes exist; confirm by eye.
  const tok = text.match(/\b[A-Z][A-Z0-9]{2,}_[A-Z0-9_]{3,}\b/);
  if (tok) {
    flag('🟡', 'D15', `"${tok[0].slice(0, 40)}" reads like a campaign/tracking token lifted as copy — confirm it is genuine content`);
  }
  // D15 TEXT-LEAK advisory — converter micro-syntax that leaked into copy:
  // `[sup]`/`[sub]` markers, `label^tooltip` carets, `|||` field-delimiter runs.
  const leak = text.match(/\[su[pb]\]|[A-Za-z]\^[A-Za-z]|\|{3,}/);
  if (leak) {
    flag('🟡', 'D15', `converter syntax leaked into copy ("${leak[0]}") — [sup]/[sub], ^tooltip carets and ||| runs are encoder artefacts; fix the encoder, then regenerate (TEXT-LEAK)`);
  }
  // TEXT hygiene advisories — punctuation-only paragraphs and blank alts.
  const dots = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].filter((p) => { const t = stripTags(p[1]).replace(/&nbsp;|&#160;/g, ''); return t && /^[\s\p{P}]+$/u.test(t); });
  if (dots.length) {
    flag('🟡', 'TEXT', `${dots.length} paragraph(s) whose only text is punctuation ("${stripTags(dots[0][1]).slice(0, 10)}") — a converter artefact or a whitespace spacer (#112); drop it`);
  }
}

// TEXT alt ratio — inside blocks only (chrome/decorative imagery excluded).
function lintAlts(file, sections, flag) {
  let imgs = 0; let blank = 0;
  for (const section of sections) {
    for (const block of childDivs(section.inner)) {
      if (!classOf(block.openTag)) continue;
      for (const m of block.inner.matchAll(/<img\b[^>]*>/gi)) {
        imgs += 1;
        if (/\balt=""/i.test(m[0]) || !/\balt=/i.test(m[0])) blank += 1;
      }
    }
  }
  if (imgs >= 2 && blank / imgs > 0.5) {
    flag('🟡', 'TEXT', `${blank} of ${imgs} in-block <img> carry an empty or missing alt — editorial images need a description (D13); only genuinely decorative tiles may be alt=""`);
  }
}

// D4 LOCALIZE — canonical lookup key for a path (mirrors localize-links.mjs).
function canonicalPath(p) {
  let s = (p || '').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\.html?$/i, '');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (s === '' || s === '/index') s = '/';
  return s.replace(/\/index$/, '').toLowerCase() || '/';
}
let LOCAL = null; // { hosts:Set, paths:Set } when --source-host is given
let FRAG_ROOT = null; // content root used to resolve /fragments/ targets (D12 CONTENT)
const FRAG_WORDS = new Map(); // fragment path → prose word count (memo)

// D12 CONTENT — prose words in a fragment document outside link lists.
function fragmentProseWords(webPath) {
  if (FRAG_WORDS.has(webPath)) return FRAG_WORDS.get(webPath);
  let words = -1;
  if (FRAG_ROOT) {
    const file = path.join(FRAG_ROOT, `${webPath.replace(/^\//, '')}.html`);
    if (existsSync(file)) {
      const html = readFileSync(file, 'utf8');
      const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
      const body = (mainMatch ? mainMatch[1] : html)
        .replace(/<(ul|ol)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ');
      words = stripTags(body).split(/\s+/).filter((w) => /\w/.test(w)).length;
    }
  }
  FRAG_WORDS.set(webPath, words);
  return words;
}

function lintUrls(file, main, flag) {
  // D4 — src: only fully-qualified (content.da.live preferred) survives the
  // ingester; repo-relative /img/ delivers as about:error.
  const svgs = [];
  for (const m of main.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) {
      // #99 — an authored SVG that embeds raster data 409s the preview of every
      // page referencing it ("error from content-bus"); pure-vector SVGs pass.
      // Collected and reported ONCE (a per-URL advisory was pure noise — 5 e2e
      // pages, 0 real defects, N manual-verify prompts each).
      if (/\.svg(\?|$)/i.test(src)) svgs.push(src);
      continue;
    }
    flag('🔴', 'D4', `authored <img src="${src}"> is not fully qualified — upload to DA /media and author the content.da.live URL, or author the verified source URL (the ingester re-hosts it); never move the image into block JS (block-lint IMG-HARDCODED). Repo-relative delivers as about:error`);
  }
  if (svgs.length) {
    const list = svgs.length <= 4 ? svgs.join(', ') : `${svgs.slice(0, 4).join(', ')} (+${svgs.length - 4} more)`;
    flag('🟡', 'D4', `${svgs.length} authored SVG media reference(s) — batch-verify pure-vector (an SVG embedding raster data URIs 409s the whole page's preview, #99): ${list}`);
  }
  // D4 — href: root-relative internal links are the EDS convention; DOCUMENT-
  // relative ones (donate.html, ../x) break under path mapping.
  const fragSeen = new Set();
  for (const m of main.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    const href = m[1];
    // D12 CONTENT — a fragment link whose local target carries prose (not a link list)
    const frag = href.match(/^(?:https?:\/\/[^/]+)?((?:\/[^?#]*)?\/fragments\/[^?#]+)/i);
    if (frag && !fragSeen.has(frag[1])) {
      fragSeen.add(frag[1]);
      const n = fragmentProseWords(canonicalPath(frag[1]));
      if (n > 60) {
        flag('🟡', 'D12', `fragment ${frag[1]} carries ${n} prose words — content-bearing copy is invisible to non-rendering crawlers and costs strict AI-readability points; inline it on the page with a \`fragment | ${frag[1]}\` re-sync row (CONTENT; reference/ai-readability.md § 4 rule 4)`);
      }
    }
    if (LOCAL && /^(https?:)?\/\//i.test(href)) {
      const m = href.match(/^(?:https?:)?\/\/([^/?#]+)([^?#]*)/i);
      const host = m ? m[1].toLowerCase().replace(/^www\./, '') : '';
      if (m && LOCAL.hosts.has(host) && LOCAL.paths.has(canonicalPath(m[2]))) {
        flag('🟡', 'D4', `<a href="${href.slice(0, 80)}"> points at the SOURCE host for a page that exists in this content tree — a bounce link; run localize-links.mjs (LOCALIZE)`);
      }
    }
    // D4 — a delivery branch host or a protocol-relative URL is never authored:
    // the branch dies at merge and `//host` inherits whatever scheme serves the page.
    if (/^(?:https?:)?\/\/[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.(?:aem|hlx)\.(?:page|live)\b/i.test(href)) {
      flag('🔴', 'D4', `authored <a href="${href.slice(0, 80)}"> points at a delivery branch host — author the root-relative path (localize-links.mjs rewrites it)`);
      continue;
    }
    if (/^\/\//.test(href)) {
      flag('🔴', 'D4', `authored <a href="${href.slice(0, 80)}"> is protocol-relative — use a root-relative path or a fully-qualified URL`);
      continue;
    }
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) continue;
    flag('🔴', 'D4', `authored <a href="${href}"> is document-relative — use a root-relative path or a fully-qualified URL`);
  }
}

// -------------------------------------------------------------------- main

function collectFiles(target) {
  const st = statSync(target);
  if (st.isFile()) return [target];
  const out = [];
  for (const entry of readdirSync(target)) {
    if (entry.startsWith('.')) continue;
    const p = path.join(target, entry);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (entry.endsWith('.html')) out.push(p);
  }
  return out;
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const optVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const sourceHost = optVal('--source-host');
const contentRootOpt = optVal('--content-root');
const args = argv.filter((a, i) => a !== '--json' && !['--source-host', '--content-root'].includes(a) && !['--source-host', '--content-root'].includes(argv[i - 1]));
if (!args.length) {
  console.error('usage: davids-model-lint.mjs <content-file-or-dir> [...] [--json] [--source-host <host[,host]> [--content-root <dir>]]');
  process.exit(1);
}
FRAG_ROOT = contentRootOpt || args.find((a) => existsSync(a) && statSync(a).isDirectory()) || path.dirname(args[0]);
if (sourceHost) {
  const root = FRAG_ROOT;
  const paths = new Set();
  for (const f of collectFiles(root)) paths.add(canonicalPath(`/${path.relative(root, f).split(path.sep).join('/')}`));
  LOCAL = { hosts: new Set(sourceHost.split(',').map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean)), paths };
}

const findings = [];
for (const target of args) {
  for (const file of collectFiles(target)) {
    lintPage(file, readFileSync(file, 'utf8'), findings);
  }
}

findings.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === '🔴' ? -1 : 1));
const red = findings.filter((f) => f.sev === '🔴').length;

if (asJson) {
  console.log(JSON.stringify({ red, advisories: findings.length - red, findings }, null, 2));
} else {
  for (const f of findings) console.log(`${f.sev} ${f.rule} ${f.file}: ${f.msg}`);
  console.log(`${red === 0 ? 'PASS' : 'FAIL'} — ${red} 🔴, ${findings.length - red} 🟡 (rules: ../davids-model.md)`);
}
process.exit(red ? 2 : 0);
