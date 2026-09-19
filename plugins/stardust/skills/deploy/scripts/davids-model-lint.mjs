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
 *   … [--json] [--icons-dir icons] [--styles styles/styles.css]
 *     [--allow-empty <name[,name]>] [--source-host <host[,host]> [--content-root content]]
 *
 * --icons-dir enables the deterministic icon checks: every `:name:` token (and
 * every already-decorated `<span class="icon icon-name">`) must resolve to
 * `<dir>/name.svg|png` — the runtime prepends `icon-` itself, so an authored
 * `:icon-x:` fetches `/icons/icon-x.svg` and renders a broken-image box.
 * --styles (default: eds/styles/styles.css, then styles/styles.css) feeds the
 * variant-collision check: an authored block variant token that equals a bare
 * single-class selector in the foundation CSS (`.illu {`) is restyled by that
 * rule and collapses the whole block; the fixed reserved list is always on.
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
 *   D1  embed/video URL authored as a block        structure (default-content candidate;
 *       (channel/profile URLs exempt)                 BREADCRUMB wording for a breadcrumbs block)
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
 *   ICON-PREFIX  :icon-x: while icons/x.svg    ICON-PREFIX  :icon-x: without --icons-dir
 *       exists (--icons-dir; unambiguous)          (a site MAY own icon-x.svg)
 *   ICON-MISSING :x: with no icons/x.svg|png  VARIANT-COLLIDE token only inside a
 *       (--icons-dir only)                        compound/descendant selector of
 *   VARIANT-COLLIDE token in reserved list or     --styles (`.hero .x`, `span.x`)
 *       a bare `.x {` selector of --styles
 *       (pseudo suffixes ignored: `.x:hover {`)
 *   TABLE raw <table> under <main> (the pipeline names a block after its
 *       first cell → a `table` block whose CSS 404s; author the `table` block)
 *   EMPTY-HEADING <h1>–<h6> with no text content (the CMS emits one before
 *       the real heading; drop it at import — migrate importer-recipe rule 6)
 *   D1-EMPTY block table with 0 rows, or every cell empty of text/media/links;
 *       a section with nothing in it and no section-metadata (silent content
 *       loss — the encoder's selector missed; --allow-empty <name> declares a
 *       runtime-widget mount point, recorded in the conversion log)
 *                                            ADJACENT-BLOCKS N ≥ 2 consecutive
 *                                                same-name block tables in one section
 *                                                (one block with N rows / a repeat
 *                                                unit — migrate importer-recipe rule 10)
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
 *                                            D15 STYLE-SPACE — section-metadata `style`
 *                                                with space-separated tokens (hyphen-joined
 *                                                into one class that matches nothing)
 *                                            D12 CONTENT — a /fragments/ target in this
 *                                                tree carrying > 60 prose words (inline it
 *                                                + re-sync row; fragments cost strict pts)
 *                                            D9-VOCAB vocabulary budget, four sub-rules:
 *                                                > 12 section-style tokens per tree; > 6
 *                                                variant strings on one block; ≥ 3 variant
 *                                                tokens on one instance; > 10 single-use blocks
 *                                            D15-STYLE layout-shaped style token (`pb-sm`,
 *                                                `cols-8-4`, `h2-40`, `true`) — one per token
 *                                            STYLE-SEL style token no --styles selector reaches
 *                                                (.section.x / .x / [class~=] / [class*=])
 *                                            D1-DENSITY > 12 sections or > 6 section-metadata
 *                                                on one page (tree: one line per metric)
 *                                            D1-SPACER sections carrying only section-metadata
 *                                                > 5 % of sections or > pages (tree count)
 *                                            D15 VEHICLE-U <u>; VEHICLE-CODE empty <code>;
 *                                                VEHICLE-ZWSP NBSP/ZWSP/ZWNJ-only <p> (D8
 *                                                ledgered residual); VEHICLE-SUP Unicode
 *                                                super/subscript digits (CO₂, m² exempt);
 *                                                VEHICLE-ICON :spacer:/:gap:/:blank: token
 *                                                (tree: one line per vehicle; > 50 = encoder-
 *                                                level decision — promote to 🔴 after one clean
 *                                                rollout)
 *                                            TEXT zero-width characters inside copy
 *                                            ICON-EMPTY icons/x.svg with no child element
 *                                                (--icons-dir)
 *                                            D14 DUPROW two-row block whose ≥ 15-word rows
 *                                                overlap ≥ 60 % (a breakpoint pair; table/
 *                                                accordion/tabs/form/faq exempt)
 *
 * Icon and variant findings are reported ONCE per token with the page count;
 * in tree mode (a directory target or > 1 file) the D1 prose advisory is
 * reported ONCE per block name with the page count (single-file mode: per block).
 * The census rules (D9-VOCAB, D15-STYLE, STYLE-SEL, D1-DENSITY, D1-SPACER) are
 * tree-level rollups; `--json` in tree mode adds a `census` object ({styles,
 * variants, blocks, sections}) — the locked vocabulary the conversion log pastes.
 *
 * Dependency-free by design (regex + balanced-div walking, same technique as
 * build-harness.mjs) — content pages are machine-generated and regular; this
 * is a structural lint, not a browser-grade parser.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const WRAPPER_BLOCK_NAMES = new Set(['text', 'heading', 'title', 'image']);
const KEY_VALUE_BLOCKS = new Set(['metadata', 'section-metadata']);
const CHROME_BLOCK_NAMES = new Set(['header', 'footer', 'nav', 'page-chrome']);
const EMBED_HOST = /(youtube\.com|youtu\.be|vimeo\.com|player\.|\/embed\/)/i;
// A channel/profile URL on an embed host is a navigation link, not an embed
// (nothing auto-blocks it) — a `<a>` to it inside a block is legitimate.
const CHANNEL_URL = /youtube\.com\/(user|channel|c)\/|youtube\.com\/@|vimeo\.com\/(channels|groups)\//i;
// Default-content-expressible tags: what a prose section can carry natively.
// Variant tokens that collide with classes the boilerplate runtime/foundation
// owns (decorateButtons, decorateSections, decorateIcons, the `.icon` utility).
const RESERVED_VARIANTS = new Set(['icon', 'button', 'primary', 'secondary', 'section', 'block', 'wrapper', 'container', 'appear', 'hidden', 'default-content-wrapper', 'highlight']);
// `:name:` as the pipeline's icon syntax sees it: a lowercase token, not part
// of a time/URL (10:30:45, https://) — the lookarounds exclude word/colon
// neighbours.
const ICON_TOKEN = /(?<![\w:]):([a-z][a-z0-9_-]*):(?![\w:])/g;
// D14 DUPROW — blocks whose rows legitimately repeat wording (data, disclosure, forms).
const DUPROW_EXEMPT = new Set(['table', 'accordion', 'tabs', 'form', 'faq']);
const DUPROW_MIN_WORDS = 15;
const DUPROW_JACCARD = 0.6;
// D15 VEHICLE-ICON — an icon named as a spacer carries no meaning (fnbo's 67 B empty spacer.svg).
const SPACER_ICON = /^(spacer|gap|blank|space)(-|$)/;
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
  PENDING = findings;

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const main = mainMatch ? mainMatch[1] : html; // nav/footer docs may be bare fragments
  const sections = childDivs(main);
  const stats = { file, sections: sections.length, metaSections: 0, metadataOnly: 0 };

  for (const [si, section] of sections.entries()) {
    const kids = childDivs(section.inner);
    const defaultContentText = stripTags(childlessHtml(section.inner, kids));
    const kidNames = kids.map((k) => (classOf(k.openTag).split(/\s+/)[0] || '').toLowerCase());
    if (kidNames.includes('section-metadata')) {
      stats.metaSections += 1;
      // a section carrying ONLY its section-metadata block: the #119/#121
      // spacer/rule technique — legitimate, counted for D1-SPACER
      if (kids.length === 1 && !defaultContentText && !/<(img|picture)\b/i.test(childlessHtml(section.inner, kids))) stats.metadataOnly += 1;
    }

    for (const block of kids) {
      const cls = classOf(block.openTag);
      if (!cls) continue; // an unclassed child div is a stray wrapper, not a block
      const classes = cls.split(/\s+/);
      const name = classes[0].toLowerCase();
      lintBlock(file, section, block, name, flag);
      for (const variant of classes.slice(1)) noteVariant(file, name, variant.toLowerCase());
      noteBlock(file, name, classes.slice(1).map((v) => v.toLowerCase()));
    }

    // ADJACENT-BLOCKS 🟡 — N ≥ 2 consecutive same-name block tables in one
    // section: an importer emitted one table per source item where one block
    // with N rows (a repeat unit) was meant (migrate importer-recipe.md rule 10).
    // Unclassed child divs break a run; key-value blocks are never a repeat unit.
    const names = kids.map((k) => (classOf(k.openTag).split(/\s+/)[0] || '').toLowerCase());
    let run = 1;
    for (let i = 1; i <= names.length; i += 1) {
      if (i < names.length && names[i] && names[i] === names[i - 1]) { run += 1; continue; }
      if (run >= 2 && !KEY_VALUE_BLOCKS.has(names[i - 1])) {
        flag('🟡', 'ADJACENT-BLOCKS', `section ${si + 1}: ${run} consecutive "${names[i - 1]}" block tables in one section — one block with ${run} rows (a repeat unit), not ${run} tables (importer-recipe rule 10)`);
      }
      run = 1;
    }

    lintSectionShape(file, section, kids, defaultContentText, flag, si);
  }

  lintPipelineShapes(file, main, sections, flag);

  // D1-DENSITY — per page in single-file mode; tree mode rolls the tallies up
  // into one line per metric in reportCollected (a 4,000-page tree would
  // otherwise print thousands of copies of the same advisory).
  PAGE_STATS.push(stats);
  if (!TREE_MODE) {
    if (stats.sections > SECTIONS_PER_PAGE) flag('🟡', 'D1-DENSITY', `${stats.sections} sections on one page (budget ${SECTIONS_PER_PAGE}) — sections are bands, not paragraphs; merge same-style neighbours into one section (D1-DENSITY)`);
    if (stats.metaSections > META_PER_PAGE) flag('🟡', 'D1-DENSITY', `${stats.metaSections} sections carry section-metadata on one page (budget ${META_PER_PAGE}) — per-band styling belongs in foundation CSS, not in a style row per section (D1-DENSITY)`);
  }

  lintText(file, main, flag);
  lintAlts(file, sections, flag);
  lintUrls(file, main, flag);
  lintIcons(file, main);

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

// A cell (or a cell-less row) that carries neither text nor media nor a link.
const MEDIA_OR_LINK = /<(img|picture|video|iframe|a|svg|source)\b/i;
const cellIsEmpty = (html) => !stripTags(html).replace(/&nbsp;|&#160;|\u00a0/g, '').trim() && !MEDIA_OR_LINK.test(html);

function lintBlock(file, section, block, name, flag) {
  const rows = childDivs(block.inner);
  const label = `section ${classOf(section.openTag) || '(unnamed)'} → block "${name}"`;
  const isKeyValue = KEY_VALUE_BLOCKS.has(name);

  // D1-EMPTY 🔴 — a block table with no rows, or with every cell empty of text
  // and media, is silent content loss: the encoder's selector missed and the
  // runtime renders an empty block (three zero-row instances in one wave, one
  // across 15 pages). A runtime-widget mount point (`<div class="form"></div>`)
  // is declared with --allow-empty <name> and recorded in the conversion log.
  if (!ALLOW_EMPTY.has(name)) {
    if (!rows.length) {
      flag('🔴', 'D1-EMPTY', `${label}: block table with 0 rows — silent content loss (the encoder's selector missed the source items); fix the encoder, or declare a runtime-widget placeholder with --allow-empty ${name} and record it in the conversion log`);
    } else if (!isKeyValue && rows.every((row) => { const cells = childDivs(row.inner); return cells.length ? cells.every((c) => cellIsEmpty(c.inner)) : cellIsEmpty(row.inner); })) {
      flag('🔴', 'D1-EMPTY', `${label}: ${rows.length} row(s) whose every cell is empty of text, media and links — silent content loss (the encoder's cell selectors missed); fix the encoder, or declare a placeholder with --allow-empty ${name}`);
    }
  }

  // D1 — wrapper block around bare default content.
  if (WRAPPER_BLOCK_NAMES.has(name)) {
    flag('🔴', 'D1', `${label}: block named "${name}" wraps bare default content — author it as default content in the section instead`);
  }

  // CHROME — nav/footer inlined into a content document is an owner decision
  // (David's Model #8 authoring groups, #12 fragments), never the default.
  if (CHROME_BLOCK_NAMES.has(name) && !CHROME_PATH.test(file)) {
    flag('🟡', 'CHROME', `${label}: chrome block "${name}" inlined into a content document — an owner decision recorded in direction.md (or stardust/decisions.md)? Default is the runtime fragment (reference/ai-readability.md § 5)`);
  }

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
        if (links.length === 1 && EMBED_HOST.test(links[0][1]) && !CHANNEL_URL.test(links[0][1]) && text === stripTags(links[0][2])) {
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
      // D15 STYLE-SPACE — `style: a b` becomes ONE class `a-b`; tokens are comma-separated (#120).
      if (name === 'section-metadata') {
        const k = stripTags(cells[0].inner).toLowerCase();
        const v = stripTags(cells[1].inner).trim();
        if (k === 'style' && /\s/.test(v) && !v.includes(',')) {
          flag('🟡', 'D15', `${label} row ${ri + 1}: style "${v}" is space-separated — the pipeline hyphen-joins it into one class (.${v.replace(/\s+/g, '-')}) that matches no rule; comma-separate the tokens (STYLE-SPACE, #120)`);
        } else if (k === 'style') {
          // census: comma = N classes (D7); a token with inner whitespace is STYLE-SPACE's
          for (const t of v.toLowerCase().split(/\s*,\s*/).filter((x) => x && !/\s/.test(x))) noteStyle(file, t);
        }
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

  // D14 DUPROW 🟡 — a two-row block whose rows repeat each other is a breakpoint
  // pair (row 2 = the mobile copy). Restricted to exactly two prose-sized rows
  // outside data/disclosure blocks: any-pair overlap fired 1,700× on forms.
  if (rows.length === 2 && !isKeyValue && !DUPROW_EXEMPT.has(name)) {
    const words = rows.map((r) => new Set(stripTags(r.inner).replace(/&[a-z#0-9]+;/gi, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)));
    if (words[0].size >= DUPROW_MIN_WORDS && words[1].size >= DUPROW_MIN_WORDS) {
      const inter = [...words[0]].filter((w) => words[1].has(w)).length;
      const j = inter / (words[0].size + words[1].size - inter);
      if (j >= DUPROW_JACCARD) {
        flag('🟡', 'D14', `${label}: row 2 duplicates row 1 (J=${j.toFixed(2)}) — a breakpoint pair; one copy per message, responsive differences are CSS (DUPROW; encode-contract.md § spacer ladder)`);
      }
    }
  }

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
      // Tree mode reports this ONCE per block name (a page-chrome block such
      // as a breadcrumb trail fires it on every page — 61→93 copies of one advisory).
      rollup(file, '🟡', 'D1', `prose:${name}`, 1, (n, files, single) => {
        if (/^breadcrumbs?$/.test(name)) return `authored breadcrumb trail ("${name}" block) on ${single ? 'this page' : `${files.size} pages`} — chrome derived from the URL path: build it in buildAutoBlocks() with a /nav label map (EW5 fourth shape); if authoring is deliberate, author one <ul> per page (BREADCRUMB)`;
        if (single) return `${label}: single-column, ${rows.length}-row block holding only prose elements — default-content candidate (justify in the conversion log if it is a genuine bespoke widget)`;
        return `block "${name}": single-column block (≤ 3 rows) holding only prose elements on ${files.size} page(s) — default-content candidate (justify in the conversion log if it is a genuine bespoke widget)`;
      });
    }
  }
}

// ----------------------------------------------- tree-mode rollups
// A finding that recurs on every page of a tree (the same block, the same
// authoring habit) is collected here and reported ONCE with the page count;
// in single-file mode it is flagged on the spot with its per-page wording.
let TREE_MODE = false; // set in main: a directory target or > 1 file
const ROLLUPS = new Map(); // key → { sev, rule, files:Set, count, mk }
let PENDING = null; // findings array while lintPage runs (single-file flags)
function rollup(file, sev, rule, key, n, mk) {
  if (!TREE_MODE) { PENDING.push({ sev, rule, file, msg: mk(n, new Set([file]), true) }); return; }
  if (!ROLLUPS.has(key)) ROLLUPS.set(key, { sev, rule, files: new Set(), count: 0, mk });
  const r = ROLLUPS.get(key);
  r.files.add(file);
  r.count += n;
}

function lintSectionShape(file, section, kids, defaultContentText, flag, si) {
  // D1-EMPTY 🔴 — a section with no text, link or image and no section-metadata
  // child is an empty band nobody authored (the sanctioned spacer/rule is a
  // section-metadata-only section, #119; empty blocks are flagged per block).
  if (!kids.length && cellIsEmpty(section.inner)) {
    flag('🔴', 'D1-EMPTY', `section ${si + 1}: no text, link, image or block and no section-metadata — an empty band is silent content loss (or an importer artefact); a spacer/rule is a section-metadata-only section (#119)`);
  }
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
  // EMPTY-HEADING 🔴 — a heading with no text: the CMS emits one before the
  // real heading and an importer that copies it ships a dead outline entry
  // (an empty band); drop it at import (migrate importer-recipe.md rule 6).
  // A heading holding only a picture/icon is not empty.
  const emptyHeads = [...main.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .filter((m) => !/<(img|picture|span[^>]*class="[^"]*\bicon\b)/i.test(m[2]) && !stripTags(m[2]).replace(/&nbsp;|\u00a0/g, '').trim());
  if (emptyHeads.length) {
    flag('🔴', 'EMPTY-HEADING', `${emptyHeads.length} empty heading(s) <h1>–<h6> with no text content — the CMS emits one before the real heading; drop it at import (importer-recipe rule 6)`);
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
  const paras = [...main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const dots = paras.filter((p) => { const t = stripTags(p[1]).replace(/&nbsp;|&#160;/g, ''); return t && /^[\s\p{P}]+$/u.test(t); });
  if (dots.length) {
    flag('🟡', 'TEXT', `${dots.length} paragraph(s) whose only text is punctuation ("${stripTags(dots[0][1]).slice(0, 10)}") — a converter artefact or a whitespace spacer (#112); drop it`);
  }

  // D15 VEHICLE — inline vehicles borrowed for a job they do not have
  // (encode-contract.md § Authoring shapes, § spacer ladder). All 🟡; tree mode
  // rolls each vehicle up to one line (count, pages) — a spacer habit recurs on
  // every page, and > 50 hits is an encoder-level decision, not page edits.
  const vehicle = (key, n, what, remedy) => n && rollup(file, '🟡', 'D15', `vehicle:${key}`, n, (c, files, single) => `${c} ${what}${single ? '' : ` across ${files.size} page(s)`}${c > 50 ? ' — an encoder-level decision, not per-page edits' : ''} — ${remedy} (VEHICLE-${key.toUpperCase()})`);
  vehicle('u', [...main.matchAll(/<u\b/gi)].length, '<u> element(s)', '<u> has no permitted meaning in a document: a link underline is the default link style, small print is a block variant or section style, centring is the `center` variant (encode-contract.md § Authoring shapes → <u> row)');
  vehicle('code', [...main.matchAll(/<code\b[^>]*>(?:&nbsp;|&#160;|\u00a0|\s)*<\/code>/gi)].length, 'empty <code> spacer(s)', '<code> is code/flags/paths only; the height belongs to a margin, an adjacency rule or a named section style (encode-contract.md § spacer ladder rung 1-3)');
  // Invisible-only paragraphs: NBSP / ZWSP / ZWNJ as entity or code point. A
  // <code>-only paragraph is VEHICLE-CODE's; ASCII whitespace alone is not a vehicle.
  const INV = '&#8203;|&#x200b;|\\u200b|&zwnj;|&#8204;|\\u200c|&nbsp;|&#160;|\\u00a0';
  const invOne = new RegExp(INV, 'i');
  const invAll = new RegExp(INV, 'gi');
  const ghosts = paras.filter((p) => { if (/<code\b/i.test(p[1])) return false; const raw = p[1].replace(/<[^>]+>/g, ''); return invOne.test(raw) && !raw.replace(invAll, '').replace(/\s/g, ''); });
  vehicle('zwsp', ghosts.length, 'invisible-character spacer paragraph(s) (NBSP/ZWSP/ZWNJ only)', 'dropped or line-boxed by the pipeline (#112); D8: allowed only as a ledgered residual — page and count in the conversion log (encode-contract.md § spacer ladder rung 4)');
  const ZW = '\\u200b|\\u200c|&#8203;|&#x200b;|&zwnj;|&#8204;';
  const inlineZw = [...text.matchAll(new RegExp(`\\w(?:${ZW})|(?:${ZW})\\w`, 'gi'))].length;
  if (inlineZw) rollup(file, '🟡', 'TEXT', 'zwsp-inline', inlineZw, (c, files, single) => `${c} zero-width character(s) inside copy${single ? '' : ` across ${files.size} page(s)`} — a source artefact (ZWSP/ZWNJ inside words or alt text), not a spacer; strip at capture (VEHICLE-ZWSP inline)`);
  // Unicode super/subscript digits; chemical and unit notation (CO₂, m², cm³) is exempt.
  const sup = [...text.matchAll(/(?<!\b(?:CO|H|O|N|SO|NO|CH|m|cm|km|mm|ft|in))[²³¹⁰-⁹₀-₉]/gu)];
  vehicle('sup', sup.length, `Unicode superscript/subscript digit(s) (${sup.length ? `"${text.slice(Math.max(0, sup[0].index - 8), sup[0].index + 1)}"` : ''})`, 'keep <sup>/<sub> from the source DOM; chemical and unit notation (CO₂, m²) is exempt (encode-contract.md § Authoring shapes → <sup>/<sub> row)');
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
    // D4 🔴 — a delivery branch host or a protocol-relative URL is never authored:
    // the branch dies at merge and `//host` inherits whatever scheme serves the page.
    // Checked BEFORE the LOCALIZE advisory so `//source-host/p` is one 🔴, not 🔴 + 🟡.
    if (/^(?:https?:)?\/\/[a-z0-9-]+--[a-z0-9-]+--[a-z0-9-]+\.(?:aem|hlx)\.(?:page|live)\b/i.test(href)) {
      flag('🔴', 'D4', `authored <a href="${href.slice(0, 80)}"> points at a delivery branch host — author the root-relative path (localize-links.mjs rewrites it)`);
      continue;
    }
    if (/^\/\//.test(href)) {
      flag('🔴', 'D4', `authored <a href="${href.slice(0, 80)}"> is protocol-relative — use a root-relative path or a fully-qualified URL`);
      continue;
    }
    if (LOCAL && /^(https?:)?\/\//i.test(href)) {
      const m = href.match(/^(?:https?:)?\/\/([^/?#]+)([^?#]*)/i);
      const host = m ? m[1].toLowerCase().replace(/^www\./, '') : '';
      if (m && LOCAL.hosts.has(host) && LOCAL.paths.has(canonicalPath(m[2]))) {
        flag('🟡', 'D4', `<a href="${href.slice(0, 80)}"> points at the SOURCE host for a page that exists in this content tree — a bounce link; run localize-links.mjs (LOCALIZE)`);
      }
    }
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) continue;
    flag('🔴', 'D4', `authored <a href="${href}"> is document-relative — use a root-relative path or a fully-qualified URL`);
  }
}

// ------------------------------------------- icon tokens / variant tokens
// Both are collected across the run and reported once per token (tree mode):
// a mis-authored icon recurs on every page that uses it, and a per-page line
// would bury the one fix under N copies.

let ICONS_DIR = null; // --icons-dir, when given
const ALLOW_EMPTY = new Set(); // --allow-empty block names (runtime-widget mount points)
let STYLES = null; // { file, bare:Set, compound:Set } from --styles, when resolvable
const ICON_USES = new Map(); // token → Set(file)
const VARIANT_USES = new Map(); // token → { files:Set, blocks:Set }

function lintIcons(file, main) {
  const seen = new Set();
  for (const m of stripTags(main).matchAll(ICON_TOKEN)) seen.add(m[1]);
  // Already-decorated form (a pre-rendered import): <span class="icon icon-x">
  for (const m of main.matchAll(/<span\b[^>]*\bclass="([^"]*)"/gi)) {
    const cls = m[1].split(/\s+/);
    if (!cls.includes('icon')) continue;
    for (const c of cls) if (c.startsWith('icon-') && c.length > 5) seen.add(c.slice(5));
  }
  for (const t of seen) {
    if (!ICON_USES.has(t)) ICON_USES.set(t, new Set());
    ICON_USES.get(t).add(file);
  }
}

function noteVariant(file, blockName, token) {
  if (!token || token === blockName) return;
  if (!VARIANT_USES.has(token)) VARIANT_USES.set(token, { files: new Set(), blocks: new Set() });
  const u = VARIANT_USES.get(token);
  u.files.add(file);
  u.blocks.add(blockName);
}

// ------------------------------------------- vocabulary census (D9 budget)
// Thresholds — the vocabulary budget (foundation.md § Vocabulary budget) made
// mechanical. All census rules are 🟡 and never change the exit code.
const STYLES_BUDGET = 12; // distinct section-style tokens per tree
const VARIANT_TOKENS_MAX = 3; // variant tokens on one block instance (≥ fires)
const VARIANT_STRINGS_BUDGET = 6; // distinct variant strings per block
const SINGLE_USE_BUDGET = 10; // block names used on one page only
const SECTIONS_PER_PAGE = 12;
const META_PER_PAGE = 6; // sections carrying section-metadata on one page
const SPACER_PCT = 5; // metadata-only sections as % of all sections
// A layout-shaped style token encodes a measurement or a grid in its name
// (`pb-sm`, `cols-8-4`, `h2-40`, `true`) — a class-sized design decision
// delegated to authors; the closed set names intent (`dark`, `tinted`).
const LAYOUT_TOKEN = /\d|^(cols?|offset|lg|md|sm|xs|pad|pt|pb|mt|mb|u|separator|gap|img|space|spacing)-|^(true|false)$/;
const STYLE_USES = new Map(); // token → { count, files:Set }
const BLOCK_USES = new Map(); // name → { files:Set, instances, strings:Map(variantString→count), wide:[] }
const PAGE_STATS = []; // { file, sections, metaSections, metadataOnly } per page

function noteStyle(file, token) {
  if (!STYLE_USES.has(token)) STYLE_USES.set(token, { count: 0, files: new Set() });
  const u = STYLE_USES.get(token);
  u.count += 1;
  u.files.add(file);
}

function noteBlock(file, name, variants) {
  if (!BLOCK_USES.has(name)) BLOCK_USES.set(name, { files: new Set(), instances: 0, strings: new Map(), wide: [] });
  const u = BLOCK_USES.get(name);
  u.files.add(file);
  u.instances += 1;
  const tokens = variants.filter((v) => v && v !== name);
  if (tokens.length) {
    const s = tokens.join(' ');
    u.strings.set(s, (u.strings.get(s) || 0) + 1);
    if (tokens.length >= VARIANT_TOKENS_MAX) u.wide.push({ file, variant: s });
  }
}

// STYLE-SEL — does the foundation CSS reach this section-style token at all?
// `.section.tok` / `.tok` (bare or compound), `[class~='tok']` (exact) or
// `[class*='sub']` with `sub` inside the token (cigna's band rules).
function styleSelectorExists(token) {
  if (!STYLES) return null;
  if (STYLES.bare.has(token) || STYLES.compound.has(token) || STYLES.attrExact.has(token)) return true;
  return [...STYLES.attrSub].some((sub) => token.includes(sub));
}

const top = (entries, n = 3) => entries.slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ');

function reportCensus(push) {
  const docs = PAGE_STATS.length;
  const allFiles = new Set(PAGE_STATS.map((p) => p.file));
  const styleFiles = new Set([...STYLE_USES.values()].flatMap((u) => [...u.files]));

  // D9-VOCAB — four sub-rules of the vocabulary budget.
  if (STYLE_USES.size > STYLES_BUDGET) {
    const list = [...STYLE_USES].sort((a, b) => b[1].count - a[1].count).map(([t, u]) => [t, u.count]);
    push('🟡', 'D9-VOCAB', styleFiles, `${STYLE_USES.size} distinct section-style tokens across ${docs} page(s) (budget ${STYLES_BUDGET}) — top: ${top(list, 5)}; collapse same-pattern styles into the closed set (foundation.md § Vocabulary budget; D9-VOCAB styles)`);
  }
  for (const [name, u] of [...BLOCK_USES].sort()) {
    if (u.strings.size > VARIANT_STRINGS_BUDGET) {
      const list = [...u.strings].sort((a, b) => b[1] - a[1]).map(([s, n]) => [`"${s}"`, `×${n}`]);
      push('🟡', 'D9-VOCAB', u.files, `block "${name}": ${u.strings.size} distinct variant strings across ${u.files.size} page(s) (budget ${VARIANT_STRINGS_BUDGET}) — top: ${top(list)}; collapse into ≤ ${VARIANT_STRINGS_BUDGET} named variants (D9-VOCAB variants)`);
    }
  }
  const wide = [...BLOCK_USES].flatMap(([name, u]) => u.wide.map((w) => ({ name, ...w })));
  if (wide.length) {
    const ex = wide[0];
    push('🟡', 'D9-VOCAB', new Set(wide.map((w) => w.file)), `${wide.length} block instance(s) carry ≥ ${VARIANT_TOKENS_MAX} variant tokens (e.g. ${ex.name} "${ex.variant}") — a per-band design decision delegated to authors (D6/D9); fold each combination into one named variant (D9-VOCAB tokens)`);
  }
  const singleUse = [...BLOCK_USES].filter(([name, u]) => u.files.size === 1 && !KEY_VALUE_BLOCKS.has(name));
  if (singleUse.length > SINGLE_USE_BUDGET) {
    push('🟡', 'D9-VOCAB', new Set(singleUse.map(([, u]) => [...u.files][0])), `${singleUse.length} of ${BLOCK_USES.size} block names appear on one page only (budget ${SINGLE_USE_BUDGET}): ${capped(singleUse.map(([n]) => n), 8).join(', ')}${singleUse.length > 8 ? ` (+${singleUse.length - 8} more)` : ''} — collapse into a shared block + variant, or default content (D9-VOCAB single-use)`);
  }

  // D15-STYLE — one line per layout-shaped token; STYLE-SEL — one per unreached token.
  for (const [token, u] of [...STYLE_USES].sort()) {
    if (LAYOUT_TOKEN.test(token)) {
      push('🟡', 'D15-STYLE', u.files, `section-style token "${token}" (${u.count} section(s)) encodes a measurement/grid in its name — a class-sized decision delegated to authors; name the intent (dark, tinted, narrow) and size it in CSS (D15-STYLE)`);
    }
    if (styleSelectorExists(token) === false) {
      push('🟡', 'STYLE-SEL', u.files, `section-style token "${token}" (${u.count} section(s)) matches no selector in ${STYLES.file} (.section.${token}, [class~='${token}'] or a [class*=] substring) — add the rule or drop the token (STYLE-SEL)`);
    }
  }

  // D1-DENSITY (tree mode; single-file mode flags per page in lintPage) — one line per metric.
  if (TREE_MODE && docs) {
    const metric = (key, budget, label) => {
      const over = PAGE_STATS.filter((p) => p[key] > budget).sort((a, b) => b[key] - a[key]);
      if (!over.length) return;
      push('🟡', 'D1-DENSITY', new Set(over.map((p) => p.file)), `${over.length}/${docs} pages carry > ${budget} ${label}, max ${over[0][key]} — top: ${top(over.map((p) => [path.basename(p.file), p[key]]))} (D1-DENSITY)`);
    };
    metric('sections', SECTIONS_PER_PAGE, 'sections');
    metric('metaSections', META_PER_PAGE, 'sections with section-metadata');
  }

  // D1-SPACER — sections that carry only their section-metadata block, as a tree-level count.
  const totalSections = PAGE_STATS.reduce((n, p) => n + p.sections, 0);
  const spacers = PAGE_STATS.reduce((n, p) => n + p.metadataOnly, 0);
  const pct = totalSections ? (spacers / totalSections) * 100 : 0;
  if (spacers && (pct > SPACER_PCT || spacers > docs)) {
    push('🟡', 'D1-SPACER', new Set(PAGE_STATS.filter((p) => p.metadataOnly).map((p) => p.file)), `${spacers} section(s) (${pct.toFixed(1)} %) carry only section-metadata — a spacer or rule; acceptable only as the #119 rule replacement with a closed-set style; spacing belongs in \`main .section\` CSS (D1-SPACER)`);
  }

  // --json census (tree mode): what the conversion log's "locked vocabulary" pastes.
  if (!TREE_MODE) return null;
  const mean = (key) => (docs ? +(PAGE_STATS.reduce((n, p) => n + p[key], 0) / docs).toFixed(2) : 0);
  const max = (key) => Math.max(0, ...PAGE_STATS.map((p) => p[key]));
  return {
    styles: [...STYLE_USES].sort().map(([token, u]) => ({ token, count: u.count, pages: u.files.size, layoutShaped: LAYOUT_TOKEN.test(token), selector: styleSelectorExists(token) })),
    variants: [...BLOCK_USES].sort().flatMap(([block, u]) => [...u.strings].sort().map(([variant, count]) => ({ block, variant, count }))),
    blocks: [...BLOCK_USES].sort().map(([name, u]) => ({ name, pages: u.files.size, instances: u.instances })),
    sections: {
      perPage: { mean: mean('sections'), max: max('sections'), over12: PAGE_STATS.filter((p) => p.sections > SECTIONS_PER_PAGE).length },
      metadataPerPage: { mean: mean('metaSections'), max: max('metaSections'), over6: PAGE_STATS.filter((p) => p.metaSections > META_PER_PAGE).length },
      metadataOnly: { count: spacers, pct: +pct.toFixed(1) },
    },
    pages: allFiles.size,
  };
}

function iconExists(name) {
  return ['svg', 'png'].some((ext) => existsSync(path.join(ICONS_DIR, `${name}.${ext}`)));
}

function iconIsEmptySvg(name) {
  const f = path.join(ICONS_DIR, `${name}.svg`);
  return existsSync(f) && /<svg\b[^>]*>\s*<\/svg>/i.test(readFileSync(f, 'utf8'));
}

// Bare single-class selectors (`.illu {`) vs classes that only appear inside
// compound/descendant selectors (`span.icon`, `.hero .illu`). Comment-stripped
// regex walk over rule preludes; at-rule preludes (@media …) are skipped.
function parseStyles(css) {
  const bare = new Set();
  const compound = new Set();
  const attrExact = new Set(); // [class~='x'] / [class='x']
  const attrSub = new Set(); // [class*='x'] / [class^='x'] / [class|='x'] — matched as a substring
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const a of prelude.matchAll(/\[class\s*([~*^|$]?=)\s*['"]?([^'"\]\s]+)['"]?\s*\]/g)) {
      (a[1] === '~=' || a[1] === '=' ? attrExact : attrSub).add(a[2].toLowerCase());
    }
    for (const sel of prelude.split(',').map((x) => x.trim()).filter(Boolean)) {
      // `.x:hover {` / `.x::before {` target the block element exactly like
      // `.x {`; classes that appear only inside :not()/:where()/:is() arguments
      // never reach a block, so pseudo suffixes (with arguments) are dropped.
      const base = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
      const lone = base.match(/^\.([a-zA-Z_-][\w-]*)$/);
      if (lone) { bare.add(lone[1].toLowerCase()); continue; }
      for (const c of base.matchAll(/\.([a-zA-Z_-][\w-]*)/g)) compound.add(c[1].toLowerCase());
    }
  }
  return { bare, compound, attrExact, attrSub };
}

function pagesLabel(files) {
  return files.size === 1 ? [...files][0] : `${files.size} pages`;
}

function reportCollected(findings) {
  const push = (sev, rule, files, msg) => findings.push({ sev, rule, file: pagesLabel(files), pages: [...files].sort(), msg });

  for (const [, r] of [...ROLLUPS].sort()) push(r.sev, r.rule, r.files, r.mk(r.count, r.files, false));

  for (const [token, files] of [...ICON_USES].sort()) {
    const prefixed = token.startsWith('icon-');
    if (SPACER_ICON.test(token)) push('🟡', 'D15', files, `icon token ":${token}:" is a spacer vehicle — an empty icon carries no meaning; the height belongs to a margin, an adjacency rule or a named section style (encode-contract.md § spacer ladder; VEHICLE-ICON)`);
    if (ICONS_DIR && iconIsEmptySvg(token)) push('🟡', 'ICON-EMPTY', files, `icons/${token}.svg has no child element — an empty SVG is a spacer vehicle rendering a blank box; delete the asset and its ":${token}:" tokens (encode-contract.md § spacer ladder)`);
    if (!ICONS_DIR) {
      if (prefixed) push('🟡', 'ICON-PREFIX', files, `icon token ":${token}:" carries the icon- prefix the runtime adds itself (→ /icons/${token}.svg) — author ":${token.slice(5)}:" unless the site really owns icons/${token}.svg (pass --icons-dir to decide)`);
      continue;
    }
    if (iconExists(token)) continue;
    if (prefixed && iconExists(token.slice(5))) {
      push('🔴', 'ICON-PREFIX', files, `icon token ":${token}:" doubles the prefix — icons/${token.slice(5)}.svg exists, icons/${token}.svg does not, and the runtime fetches /icons/${token}.svg (broken-image box); author ":${token.slice(5)}:"`);
      continue;
    }
    push('🔴', 'ICON-MISSING', files, `icon token ":${token}:" has no icons/${token}.svg|png in ${ICONS_DIR} — the asset must exist in the branch before the page is PUT${prefixed ? ' (note the icon- prefix: the runtime adds it, so ":' + token.slice(5) + ':" may be what was meant)' : ''}`);
  }

  for (const [token, u] of [...VARIANT_USES].sort()) {
    const blocks = [...u.blocks].sort().join(', ');
    if (RESERVED_VARIANTS.has(token)) {
      push('🔴', 'VARIANT-COLLIDE', u.files, `variant token "${token}" on block(s) ${blocks} is a class the runtime/foundation owns (reserved list, #15) — the block inherits that rule's styling; rename the variant (e.g. "${token}-style")`);
    } else if (STYLES && STYLES.bare.has(token)) {
      push('🔴', 'VARIANT-COLLIDE', u.files, `variant token "${token}" on block(s) ${blocks} equals the bare selector ".${token} {" in ${STYLES.file} — that foundation rule restyles the whole block (#15); rename the variant`);
    } else if (STYLES && STYLES.compound.has(token)) {
      push('🟡', 'VARIANT-COLLIDE', u.files, `variant token "${token}" on block(s) ${blocks} appears inside a compound/descendant selector of ${STYLES.file} — confirm no rule reaches the block, or rename the variant`);
    }
  }

  return reportCensus(push);
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

const USAGE = 'usage: davids-model-lint.mjs <content-file-or-dir> [...] [--json] [--icons-dir <dir>] [--styles <css>] [--allow-empty <name[,name]>] [--source-host <host[,host]> [--content-root <dir>]]';
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const asJson = argv.includes('--json');
const VALUE_OPTS = ['--source-host', '--content-root', '--icons-dir', '--styles', '--allow-empty'];
const optVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const sourceHost = optVal('--source-host');
const contentRootOpt = optVal('--content-root');
const iconsDirOpt = optVal('--icons-dir');
const stylesOpt = optVal('--styles');
for (const n of (optVal('--allow-empty') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) ALLOW_EMPTY.add(n);
const args = argv.filter((a, i) => a !== '--json' && !VALUE_OPTS.includes(a) && !VALUE_OPTS.includes(argv[i - 1]));
if (!args.length) {
  console.error(USAGE);
  process.exit(1);
}
for (const o of VALUE_OPTS) {
  // a dangling `--icons-dir` would otherwise silently run with the checks off
  const i = argv.indexOf(o);
  if (i >= 0 && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) { console.error(`${o} needs a value\n${USAGE}`); process.exit(1); }
}
if (iconsDirOpt) {
  if (!existsSync(iconsDirOpt) || !statSync(iconsDirOpt).isDirectory()) { console.error(`--icons-dir ${iconsDirOpt}: not a directory`); process.exit(1); }
  ICONS_DIR = iconsDirOpt;
}
{
  // Same default resolution as render-harness / ew-editability-probe; an
  // explicit --styles that does not exist is a usage error, a missing default
  // just disables the measured selector set (the reserved list stays on).
  const stylesFile = stylesOpt || ['eds/styles/styles.css', 'styles/styles.css'].find((f) => existsSync(f)) || null;
  if (stylesOpt && !existsSync(stylesOpt)) { console.error(`--styles ${stylesOpt}: file not found`); process.exit(1); }
  if (stylesFile) STYLES = { file: stylesFile, ...parseStyles(readFileSync(stylesFile, 'utf8')) };
}
FRAG_ROOT = contentRootOpt || args.find((a) => existsSync(a) && statSync(a).isDirectory()) || path.dirname(args[0]);
if (sourceHost) {
  const root = FRAG_ROOT;
  const paths = new Set();
  for (const f of collectFiles(root)) paths.add(canonicalPath(`/${path.relative(root, f).split(path.sep).join('/')}`));
  LOCAL = { hosts: new Set(sourceHost.split(',').map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean)), paths };
}

const findings = [];
const files = args.flatMap((target) => collectFiles(target));
TREE_MODE = files.length > 1 || args.some((a) => statSync(a).isDirectory());
for (const file of files) lintPage(file, readFileSync(file, 'utf8'), findings);

const census = reportCollected(findings);
findings.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === '🔴' ? -1 : 1));
const red = findings.filter((f) => f.sev === '🔴').length;

if (asJson) {
  // `census` (tree mode only) is the locked vocabulary the conversion log pastes.
  console.log(JSON.stringify({ red, advisories: findings.length - red, findings, ...(census ? { census } : {}) }, null, 2));
} else {
  for (const f of findings) console.log(`${f.sev} ${f.rule} ${f.file}: ${f.msg}`);
  console.log(`${red === 0 ? 'PASS' : 'FAIL'} — ${red} 🔴, ${findings.length - red} 🟡 (rules: ../davids-model.md)`);
}
process.exit(red ? 2 : 0);
