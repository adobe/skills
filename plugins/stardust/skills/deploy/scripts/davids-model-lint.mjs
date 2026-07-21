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
 *   … [--json]
 *
 * Exit codes: 0 = clean (🟡 advisories allowed — review, fix or justify in the
 * conversion log), 2 = at least one 🔴, 1 = usage/parse failure.
 *
 * 🔴 (block the write)                      🟡 (advisory)
 *   D1  wrapper block around default content   D1  block section with no repeating
 *   D1  embed/video URL authored as a block        structure (default-content candidate)
 *   D2  block table nested inside a block cell D3  ragged rows (cell-count mismatch —
 *   D4  relative/repo-relative src or href         a span-shaped structure)
 *   D14 display copy in a key-value block     D10 block rows wider than 4 columns
 *   D15 code visible as text (tags/{{}}/CSS)  D5  complex nested list inside a cell
 *
 * Dependency-free by design (regex + balanced-div walking, same technique as
 * build-harness.mjs) — content pages are machine-generated and regular; this
 * is a structural lint, not a browser-grade parser.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const WRAPPER_BLOCK_NAMES = new Set(['text', 'heading', 'title', 'image']);
const KEY_VALUE_BLOCKS = new Set(['metadata', 'section-metadata']);
const EMBED_HOST = /(youtube\.com|youtu\.be|vimeo\.com|player\.|\/embed\/)/i;
// Default-content-expressible tags: what a prose section can carry natively.
const PROSE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'picture', 'img', 'source', 'strong', 'em', 'code', 'br', 'hr']);

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

  lintText(file, main, flag);
  lintUrls(file, main, flag);
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
  // Reserved for future section-level checks; default content next to blocks
  // is legitimate (section heads, D1) so nothing to flag here today.
}

function lintText(file, main, flag) {
  // D15 — code visible as text. In raw content HTML, author-visible "<tag>"
  // is entity-encoded, and template/binding syntax survives literally.
  const text = stripTags(main);
  const m = text.match(/&lt;\s*[a-z][a-z0-9-]*|\{\{[^}]*\}\}|<%|%>|\b[a-z-]+\s*:\s*[^;{}]+;\s*\}/i);
  if (m) {
    flag('🔴', 'D15', `code visible as text in authored content ("${m[0].slice(0, 40)}…") — markup/bindings/CSS never appear as author-facing text`);
  }
}

function lintUrls(file, main, flag) {
  // D4 — src: only fully-qualified (content.da.live preferred) survives the
  // ingester; repo-relative /img/ delivers as about:error.
  for (const m of main.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
    flag('🔴', 'D4', `authored <img src="${src}"> is not fully qualified — upload to DA /media and author the content.da.live URL (repo-relative delivers as about:error)`);
  }
  // D4 — href: root-relative internal links are the EDS convention; DOCUMENT-
  // relative ones (donate.html, ../x) break under path mapping.
  for (const m of main.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    const href = m[1];
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

const args = process.argv.slice(2).filter((a) => a !== '--json');
const asJson = process.argv.includes('--json');
if (!args.length) {
  console.error('usage: davids-model-lint.mjs <content-file-or-dir> [...] [--json]');
  process.exit(1);
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
