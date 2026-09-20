#!/usr/bin/env node
/**
 * ew-editability-probe.mjs — the Experience Workspace (da.live) editability gate.
 *
 * Reproduces the workspace's inline-edit instrumentation over a page and reports,
 * per block, which authored text elements survive decorate() and would therefore
 * be editable in the canvas. Mirrors da-nx nx/public/plugins/quick-edit
 * (setBody → loadPage → editors):
 *   1. stamp `data-prose-index` on every OUTERMOST h1-h6/p/ol/ul/pre/blockquote
 *      inside <main>, `data-image-index` on every <img>, `data-block-index` on
 *      every block div (as editor-utils.getInstrumentedHTML does). prose2aem keeps
 *      a <p> inside every block cell while the published pipeline unwraps
 *      single-paragraph cells to bare text — so bare-text cells are re-wrapped as
 *      <p> first (the runtime's wrapTextNodes does the same before decorate()).
 *   2. let the block JS decorate the instrumented body;
 *   3. an authored text is EDITABLE iff exactly one element still carries its
 *      `data-prose-index` (createEditor → querySelector + replaceWith). Zero =
 *      DEAD (rebuilt from textContent/innerHTML, synthesized, retagged); >1 =
 *      DUPLICATED (clone slides — the editor attaches to the first in DOM order).
 *      cloneNode(true) keeps the attribute; the fix is "move", not "avoid clone".
 *   4. --simulate-editor additionally performs the editor swap the way
 *      prose.js createEditor does (element → div.prosemirror-editor > div.ProseMirror
 *      > <same tag, no classes/spans>) and reports per text any computed-style or
 *      height drift between published and edit mode — a class on the authored
 *      element (or on an inner <span>) dies in that swap; wrapper-descendant
 *      selectors survive it (deploy reference/block-js-scaffold.md § Experience Workspace editability
 *      contract, EW2).
 *
 * Two modes:
 *   URL mode (served page, the page's own scripts.js decorates):
 *     node ew-editability-probe.mjs <url> [<url> ...] [--json] [--verbose] [--simulate-editor]
 *         [--exempt a,b] [--blocks-dir <dir>]
 *   Harness mode (no server — the render-harness/block-roundtrip technique: <main>
 *   from the content file run through the pipeline emulation (pipeline-mimic.mjs),
 *   styles.css + block CSS inlined, the runtime's decorateButtons/decorateSections/
 *   decorateBlock/wrapTextNodes DOM mimicked, then each block's JS installed as a
 *   REAL module and decorate() run per block):
 *     node ew-editability-probe.mjs --content <content/page.html> [--blocks-dir <dir>] [--root <dir>]
 *         [--styles <css>] [--width <px>] [--json] [--verbose] [--simulate-editor] [--exempt a,b]
 *         [--strict] [--no-pipeline] [--style-split comma|first-only]
 *     defaults: --blocks-dir eds/blocks then blocks; --styles eds/styles/styles.css then styles/styles.css;
 *               --root = the blocks dir's parent (the repo root the block imports resolve against)
 *
 *   The harness page (openHarness) has a synthetic origin, http://ew.harness/, whose
 *   requests are fulfilled from --root by a route intercept (no port is opened):
 *   `import('/blocks/<n>/<n>.js')` resolves the block's real imports — scripts/aem.js,
 *   project helpers, sibling blocks (41 % of harvested block files import something;
 *   a stub list covered 24 % of those imports). An unresolvable specifier is a 404 →
 *   the import rejects → the block is NOT installed → exit 2 (a block that cannot be
 *   installed must never pass). Every request to another origin is aborted and
 *   LISTED in the report (RUM sampling, a loadFragment() of /nav) so a helper that
 *   returned null cannot silently mask a failure; 404s under the root are listed too.
 *   The harness therefore never touches the source site.
 *
 * Exemptions (EW5 — exempt text is declared, not silently dropped):
 *   --exempt a,b            CLI fallback: blocks whose authored rows are config /
 *                           derived / index fallback (still reported, excluded from
 *                           the exit code; block-granular — --strict rejects it)
 *   @ew-exempt …            tag in ANY block comment of <blocksDir>/<name>/<name>.js
 *                           (a leading import or eslint pragma before the JSDoc no
 *                           longer hides it). Syntax, every part optional:
 *                             @ew-exempt [<tag>] [/regex/] [— <category>[: reason]]
 *                             @ew-exempt <p> /^\$?\d/ — derived: price re-rendered from the row
 *                             @ew-exempt <p> ISO date (cell 1) — derived
 *                             @ew-exempt all — index-driven listing, authored rows are the no-JS fallback
 *                           An ITEM-LEVEL tag (<tag> and/or /regex/) exempts only the
 *                           dead texts it matches; a tag with neither is block-granular
 *                           (every dead text of the block, today's meaning). Category
 *                           from EW_EXEMPT_CATEGORIES. Read whenever a blocks dir is
 *                           known (harness mode always; URL mode with --blocks-dir).
 *   --strict                opt-in: exit 1 when any exemption USED is block-granular
 *                           without `all`, or names no category — printing what each
 *                           tag swallowed (recorded: 254 value-slotted texts hidden
 *                           behind a 4-text showcase exemption).
 *                           (1 is this script's verdict code; block-roundtrip reports the
 *                           same finding with its verdict code, 2)
 *   metadata / section-metadata cells are pipeline config (never displayed) and
 *   are not counted at all.
 *
 * Exit code 0 = every non-exempt authored text editable and no duplicated index,
 * 1 = dead non-exempt text OR duplicated index (OR, under --strict, a granular /
 * category-less exemption in use), 2 = probe error (including a block whose JS
 * failed to install/decorate in harness mode — an undecorated block's raw rows
 * would false-pass). Unchanged by the module-resolution harness.
 *
 * The in-page functions (runtimeMimic, instrument, survey, simulateEditor), the
 * harness (openHarness, installBlockJs, runDecorate, probeContent) and the
 * exemption/aggregation helpers are EXPORTED so block-roundtrip.mjs,
 * render-harness.mjs and the qa `editability` check measure with the same
 * instrument. Importing this module does not run the CLI and does not load
 * playwright (the CLI resolves it lazily from the cwd project, then bare).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue, no-param-reassign */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { pipelineMimic, formatCounts } from './pipeline-mimic.mjs';

export const EDITABLE = 'h1, h2, h3, h4, h5, h6, p, ol, ul, pre, blockquote';
export const QE_CSS = 'https://raw.githubusercontent.com/adobe/da-nx/main/nx/public/plugins/quick-edit/quick-edit.css';
// EW5 categories a declared exemption is expected to name (informational — any
// @ew-exempt tag exempts; the category is recorded so reports can group reasons).
export const EW_EXEMPT_CATEGORIES = ['derived', 'metadata', 'index', 'integration', 'fallback', 'config', 'structure', 'all'];

// ────────────────────────────────────────────────────────────── in-page ──
// Every function below runs IN the page (Playwright-serialized: self-contained,
// ONE argument, no closure over module scope).
/* eslint-disable no-undef */

// Remove pipeline config blocks from an authored <main> — in the DOM, never by
// regexing the HTML (a lazy regex over-swallows past a shallow metadata block).
export function dropMetadata() {
  document.querySelectorAll('main div.metadata, main div.section-metadata').forEach((el) => el.remove());
}

// Block names present in an authored <main> (raw shape), pipeline config excluded.
export function discoverBlocks() {
  const names = [];
  document.querySelectorAll('main > div > div[class]').forEach((b) => {
    const n = (b.className || '').trim().split(' ')[0];
    if (n && n !== 'metadata' && n !== 'section-metadata' && !names.includes(n)) names.push(n);
  });
  return names;
}

// Mimic the vanilla runtime's decorateMain over a raw authored <main> (aem.js):
// decorateButtons (a.button.primary/.secondary from <strong>/<em> wrapping),
// decorateSections (.section + .default-content-wrapper), decorateBlock
// (.block, data-block-name, .<name>-wrapper, .<name>-container) and wrapTextNodes
// (#104: a bare-text / media-led cell folds into ONE <p> on live). Tagged
// elements (data-rt etc.) survive: they are moved, not recreated. Idempotent on
// an already-decorated main (skips sections that carry .section).
export function runtimeMimic() {
  const VALID_WRAPPERS = ['P', 'PRE', 'UL', 'OL', 'PICTURE', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  const main = document.querySelector('main');
  if (!main) return;
  const wrapTextNodes = (block) => {
    const wrap = (el) => { const w = document.createElement('p'); w.append(...el.childNodes); el.append(w); };
    block.querySelectorAll(':scope > div > div').forEach((cell) => {
      if (!cell.hasChildNodes()) return;
      const first = cell.firstElementChild;
      const hasWrapper = !!first && VALID_WRAPPERS.includes(first.tagName);
      if (!hasWrapper) wrap(cell);
      else if (first.tagName === 'PICTURE' && (cell.children.length > 1 || !!cell.textContent.trim())) wrap(cell);
    });
  };
  // decorateButtons — runs on main BEFORE sections/blocks, as in loadEager.
  main.querySelectorAll('a').forEach((a) => {
    if (a.classList.contains('button') || a.href === a.textContent || a.querySelector('img, picture')) return;
    const up = a.parentElement; const twoup = up && up.parentElement;
    if (!up) return;
    if (up.childNodes.length === 1 && (up.tagName === 'P' || up.tagName === 'DIV')) { a.className = 'button'; up.classList.add('button-container'); }
    if (twoup && up.childNodes.length === 1 && up.tagName === 'STRONG' && twoup.childNodes.length === 1 && twoup.tagName === 'P') { a.className = 'button primary'; twoup.classList.add('button-container'); }
    if (twoup && up.childNodes.length === 1 && up.tagName === 'EM' && twoup.childNodes.length === 1 && twoup.tagName === 'P') { a.className = 'button secondary'; twoup.classList.add('button-container'); }
  });
  main.querySelectorAll(':scope > div').forEach((section) => {
    if (section.classList.contains('section')) return;
    const wrappers = [];
    let defaultContent = false;
    [...section.children].forEach((e) => {
      if (e.tagName === 'DIV' || !defaultContent) {
        const wrapper = document.createElement('div');
        wrappers.push(wrapper);
        defaultContent = e.tagName !== 'DIV';
        if (defaultContent) wrapper.classList.add('default-content-wrapper');
      }
      wrappers[wrappers.length - 1].append(e);
    });
    wrappers.forEach((w) => section.append(w));
    section.classList.add('section');
    section.querySelectorAll(':scope > div > div[class]').forEach((block) => {
      const name = block.classList[0];
      if (!name) return;
      block.classList.add('block');
      block.dataset.blockName = name;
      wrapTextNodes(block);
      block.parentElement.classList.add(`${name}-wrapper`);
      section.classList.add(`${name}-container`);
    });
  });
}

// Instrument like editor-utils.getInstrumentedHTML. Works over BOTH shapes: the
// raw authored/published <main> (URL mode) and a runtime-mimicked one (harness
// mode). Returns the instrumented document HTML plus one record per authored
// text: { index, tag, block, unit, text }. `unit` is the closest [data-rt]
// ancestor (block-roundtrip's round-trip unit), null elsewhere.
export function instrument(EDITABLE_SEL) {
  const main = document.querySelector('main');
  if (!main) return { html: document.documentElement.outerHTML, texts: [] };
  const VALID_WRAPPERS = ['P', 'PRE', 'UL', 'OL', 'PICTURE', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  const isConfig = (b) => b.classList.contains('metadata') || b.classList.contains('section-metadata');
  const texts = [];
  let n = 1;
  // prose2aem keeps the <p> inside every block cell; the published pipeline unwraps
  // a single-paragraph cell to bare text (or a bare <a>/<strong>). Restore the <p>
  // exactly as the runtime's wrapTextNodes will, so the cell looks like the
  // workspace's instrumented HTML. Idempotent on an already-wrapped cell.
  const wrapCell = (cell) => {
    if (!cell.hasChildNodes()) return;
    const first = cell.firstElementChild;
    const hasWrapper = !!first && VALID_WRAPPERS.includes(first.tagName);
    const needs = !hasWrapper || (first.tagName === 'PICTURE' && (cell.children.length > 1 || !!cell.textContent.trim()));
    if (!needs) return;
    const p = document.createElement('p');
    p.append(...cell.childNodes);
    cell.append(p);
  };
  main.querySelectorAll(':scope > div > div[class], main .block').forEach((block) => {
    if (isConfig(block) || block.classList.contains('default-content-wrapper') || /-wrapper$/.test(block.classList[0] || '')) return;
    block.querySelectorAll(':scope > div > div').forEach(wrapCell);
  });
  const blockOf = (el) => {
    const decorated = el.closest('main .block[data-block-name]');
    if (decorated) return decorated.dataset.blockName;
    const section = el.closest('main > div');
    const top = [...(section?.children ?? [])].find((c) => c.contains(el));
    if (!top || top.tagName !== 'DIV' || !top.classList.length || top.classList.contains('default-content-wrapper')) return 'default';
    return top.classList[0];
  };
  main.querySelectorAll(EDITABLE_SEL).forEach((el) => {
    if (el.parentElement?.closest(EDITABLE_SEL)) return; // outermost only
    const block = blockOf(el);
    if (block === 'metadata' || block === 'section-metadata') return; // pipeline config, never displayed
    n += 1;
    el.setAttribute('data-prose-index', String(n));
    // Text-less elements (an image-only <p>, an empty paragraph) are stamped like
    // the workspace does but not surveyed: images are edited via data-image-index,
    // and there is no text for an editor to attach to (same rule as
    // section-schema editableTexts / content-inventory editableInventory).
    if (el.textContent.trim()) {
      const unitEl = el.closest('[data-rt]');
      texts.push({ index: n, tag: el.tagName.toLowerCase(), block, unit: unitEl ? unitEl.getAttribute('data-rt') : null, text: el.textContent.trim().slice(0, 70) });
    }
    n += el.textContent.length + 1;
  });
  main.querySelectorAll('img').forEach((img) => { n += 1; img.setAttribute('data-image-index', String(n)); });
  main.querySelectorAll(':scope > div > div[class], main .block').forEach((b) => { if (!isConfig(b) && !b.classList.contains('default-content-wrapper')) { n += 1; b.setAttribute('data-block-index', String(n)); } });
  return { html: document.documentElement.outerHTML, texts };
}

// In the decorated page: which indices survived, how many times, and where.
export function survey(texts) {
  return texts.map((t) => {
    const hits = [...document.querySelectorAll(`[data-prose-index="${t.index}"]`)];
    const first = hits[0];
    const visible = first ? first.getClientRects().length > 0 : false;
    const liveText = first ? first.textContent.trim().slice(0, 70) : null;
    return { ...t, hits: hits.length, visible, liveText, sameText: first ? liveText === t.text : false };
  });
}

// In the decorated page: swap every surviving element for a ProseMirror-shaped
// editor (prose.js createEditor) and measure style/height drift.
export function simulateEditor(texts) {
  const rec = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily.split(',')[0], lineHeight: cs.lineHeight, color: cs.color };
  };
  const blockRect = {};
  document.querySelectorAll('main .block').forEach((b) => { blockRect[b.dataset.blockName] = Math.round(b.getBoundingClientRect().height); });
  const before = {};
  texts.forEach((t) => { const el = document.querySelector(`[data-prose-index="${t.index}"]`); if (el) before[t.index] = rec(el); });
  texts.forEach((t) => {
    const el = document.querySelector(`[data-prose-index="${t.index}"]`);
    if (!el || el.querySelector('img, picture')) return; // images are edited via data-image-index, not a text editor
    const parent = document.createElement('div');
    parent.className = 'prosemirror-editor';
    parent.setAttribute('data-prose-index', t.index);
    const pm = document.createElement('div');
    pm.className = 'ProseMirror';
    pm.setAttribute('contenteditable', 'true');
    // ProseMirror renders the DOC node, not the DOM: same tag, no classes, inline marks only.
    const node = document.createElement(el.tagName);
    node.innerHTML = el.innerHTML;
    // decorateButtons() replaced the authored <strong>/<em> with button classes; the
    // editor renders the DOC, which still has the marks — restore them for the swap
    // (decorateButtons leaves the authored <strong>/<em> in place; reuse it, never
    // double-wrap).
    node.querySelectorAll('a.button').forEach((a) => {
      const mark = a.classList.contains('accent') ? ['em', 'strong'] : a.classList.contains('primary') ? ['strong'] : a.classList.contains('secondary') ? ['em'] : [];
      let outer = a;
      mark.forEach((m) => {
        const p = outer.parentElement;
        if (p && p.tagName === m.toUpperCase() && p.childNodes.length === 1) { outer = p; return; }
        const w = document.createElement(m); outer.replaceWith(w); w.append(outer); outer = w;
      });
    });
    // presentational block spans stand for authored hard breaks: restore the <br>
    node.querySelectorAll('span').forEach((sp) => {
      const src = el.querySelectorAll('span')[[...node.querySelectorAll('span')].indexOf(sp)];
      const block = src && getComputedStyle(src).display === 'block' && sp.nextElementSibling?.tagName === 'SPAN';
      sp.replaceWith(...sp.childNodes, ...(block ? [document.createElement('br')] : []));
    });
    node.querySelectorAll('*').forEach((c) => { [...c.attributes].forEach((a) => { if (!(c.tagName === 'A' && a.name === 'href')) c.removeAttribute(a.name); }); });
    pm.append(node);
    parent.append(pm);
    el.replaceWith(parent);
  });
  const after = {};
  texts.forEach((t) => { const node = document.querySelector(`.prosemirror-editor[data-prose-index="${t.index}"] > .ProseMirror > *`); if (node) after[t.index] = rec(node); });
  const blockDelta = {};
  document.querySelectorAll('main .block').forEach((b) => { const h = Math.round(b.getBoundingClientRect().height); blockDelta[b.dataset.blockName] = h - (blockRect[b.dataset.blockName] ?? h); });
  const drift = texts.filter((t) => before[t.index] && after[t.index]).map((t) => {
    const b = before[t.index]; const a = after[t.index]; const d = [];
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color'].forEach((k) => { if (b[k] !== a[k]) d.push(`${k} ${b[k]} → ${a[k]}`); });
    if (Math.abs(b.h - a.h) > 2) d.push(`height ${b.h} → ${a.h}`);
    return { index: t.index, block: t.block, tag: t.tag, text: t.text, drift: d };
  });
  return { drift, blockDelta };
}
/* eslint-enable no-undef */

// ──────────────────────────────────────────────────────── node-side helpers ──

export const firstExisting = (cands, kind) => {
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`no ${kind} found (tried ${cands.join(', ')}) — pass it explicitly`);
  return hit;
};

// <main> of an authored content file. Only the element bounds are matched here;
// metadata blocks are removed in the DOM afterwards (dropMetadata), never by regex.
export function readMainHtml(contentPath) {
  const raw = fs.readFileSync(contentPath, 'utf8');
  const m = raw.match(/<main>([\s\S]*?)<\/main>/);
  if (!m) throw new Error(`${contentPath} has no <main> element`);
  return m[1];
}

// `--exempt a,b` → Set of block names.
export function parseExemptList(str) {
  return new Set((str || '').split(',').map((s) => s.trim()).filter(Boolean));
}

// One `@ew-exempt …` line → { raw, tag, pattern, category, reason, granular, all }.
//   `<p> /^\$?\d/ — derived: price`  item-level: tag p, regex, category derived
//   `<p> ISO date (cell 1) — derived`  item-level by tag only
//   `config rows`                     block-granular (no tag, no regex), no category
//   `all — index-driven listing`      the whole block
export function parseExemptItem(line) {
  const raw = line.replace(/^\*\s*/, '').replace(/\s*\*\/\s*$/, '').trim();
  const item = { raw, tag: null, pattern: null, category: null, reason: raw, granular: true, all: false };
  if (/^all\b/i.test(raw)) { item.all = true; item.category = 'all'; item.granular = false; item.reason = raw.replace(/^all\s*(?:[—–-]+\s*)?/i, '') || 'all'; return item; }
  let rest = raw;
  const tag = rest.match(/^<([a-z][a-z0-9]*)>\s*/i);
  if (tag) { item.tag = tag[1].toLowerCase(); rest = rest.slice(tag[0].length); }
  const pat = rest.match(/^\/((?:\\.|[^/\\])+)\/([a-z]*)\s*/);
  if (pat) { try { item.pattern = new RegExp(pat[1], pat[2]); } catch { item.pattern = null; } rest = rest.slice(pat[0].length); }
  item.granular = !item.tag && !item.pattern;
  const parts = rest.split(/\s+[—–-]+\s+|^[—–-]+\s+/).filter(Boolean);
  const afterDash = parts.length > 1 ? parts[parts.length - 1] : (rest.match(/^[—–-]+\s+(.*)$/) || [])[1] || '';
  const first = (afterDash.match(/^([a-z]+)/i) || [])[1];
  if (first && EW_EXEMPT_CATEGORIES.includes(first.toLowerCase())) item.category = first.toLowerCase();
  else item.category = EW_EXEMPT_CATEGORIES.find((c) => c !== 'all' && new RegExp(`\\b${c}\\b`, 'i').test(rest)) || null;
  item.reason = rest.trim() || raw;
  return item;
}

// @ew-exempt tags in ANY block comment of a block's JS (`/** … */` or `/* … */`,
// before or after imports / pragmas — 27 of 983 harvested block files carried the
// tag outside a file-leading JSDoc and lost every exemption). Returns null when the
// block declares nothing, else { all, reasons, categories, items }.
export function parseExemptTags(js) {
  const comments = [...js.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0]).filter((c) => /@ew-exempt\b/.test(c));
  if (!comments.length) return null;
  const items = comments.flatMap((c) => [...c.matchAll(/@ew-exempt\s+([^\n]*)/g)].map((m) => parseExemptItem(m[1]))).filter((it) => it.raw);
  if (!items.length) return null;
  return {
    all: items.some((it) => it.all),
    reasons: items.map((it) => it.raw),
    categories: [...new Set(items.map((it) => it.category).filter((c) => c && c !== 'all'))],
    items,
  };
}

// The exemption item that covers a dead survey row, or null. A specific
// (item-level) match is credited before a block-granular tag, so --strict can
// tell declared items from a blanket.
export function matchExemption(ex, r) {
  if (!ex) return null;
  const items = ex.items || (ex.reasons ? [{ raw: ex.reasons.join('; '), granular: !ex.all, all: !!ex.all, category: ex.all ? 'all' : (ex.categories || [])[0] || null, reason: ex.reasons.join('; ') }] : []);
  if (ex.all) return items.find((it) => it.all) || items[0] || null;
  return items.find((it) => !it.granular && (!it.tag || it.tag === r.tag) && (!it.pattern || it.pattern.test(r.text || '')))
    || items.find((it) => it.granular) || null;
}

// Exemptions for a set of blocks: JSDoc tags from <blocksDir>/<name>/<name>.js
// (when a blocks dir is known) ∪ the CLI list. Returns { name: {all, reasons, categories, source} }.
export function readBlockExemptions(blocksDir, names, cliExempt = new Set()) {
  const out = {};
  (names || []).forEach((name) => {
    if (!blocksDir) return;
    let js;
    try { js = fs.readFileSync(path.join(blocksDir, name, `${name}.js`), 'utf8'); } catch { return; }
    const tags = parseExemptTags(js);
    if (tags) out[name] = { ...tags, source: '@ew-exempt' };
  });
  cliExempt.forEach((name) => {
    const cli = { raw: '--exempt (CLI)', tag: null, pattern: null, category: null, reason: '--exempt (CLI)', granular: true, all: false };
    if (out[name]) { out[name].reasons = [...out[name].reasons, cli.raw]; out[name].items = [...(out[name].items || []), cli]; }
    else out[name] = { all: false, reasons: [cli.raw], categories: [], items: [cli], source: '--exempt' };
  });
  return out;
}

// Group survey rows per block (or per any key) into the gate's counters.
//   rows: survey() output; sim: simulateEditor() output or null;
//   exemptions: readBlockExemptions() output; keyOf: row → group key (default block).
export function aggregate(rows, { sim = null, exemptions = {}, keyOf = (r) => r.block, blockOf = (r) => r.block } = {}) {
  const byKey = {};
  rows.forEach((r) => {
    const key = keyOf(r);
    const block = blockOf(r);
    const ex = exemptions[block];
    const b = byKey[key] ??= { block: key, authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0, textDrift: 0, deadItems: [], dupItems: [], exemptItems: [], exemptReasons: ex ? ex.reasons : [], exemptUsed: [] };
    b.authored += 1;
    const label = `<${r.tag}> ${r.text}`;
    if (r.hits === 1) { b.editable += 1; if (!r.sameText) b.textDrift += 1; }
    else if (r.hits > 1) { b.duplicated += 1; b.editable += 1; b.dupItems.push({ tag: r.tag, text: r.text, hits: r.hits, label: `${label} (×${r.hits})` }); }
    else {
      const hit = matchExemption(ex, r);
      if (hit) {
        b.exempt += 1;
        b.exemptItems.push({ tag: r.tag, text: r.text, label, category: hit.category, reason: hit.reason || hit.raw });
        const used = b.exemptUsed.find((u) => u.item === hit) || (b.exemptUsed.push({ item: hit, raw: hit.raw, category: hit.category, granular: !!hit.granular, all: !!hit.all, count: 0 }), b.exemptUsed[b.exemptUsed.length - 1]);
        used.count += 1;
      } else { b.dead += 1; b.deadItems.push({ tag: r.tag, text: r.text, label }); }
    }
  });
  if (sim) {
    sim.drift.forEach((d) => {
      const b = byKey[keyOf(d)] || byKey[d.block];
      if (!b) return;
      b.editDrift = (b.editDrift ?? 0) + (d.drift.length ? 1 : 0);
      if (d.drift.length) (b.driftItems ??= []).push(`<${d.tag}> ${d.text.slice(0, 40)} :: ${d.drift.join('; ')}`);
    });
    Object.entries(sim.blockDelta).forEach(([name, delta]) => { if (byKey[name]) byKey[name].blockHeightDelta = delta; });
  }
  const blocks = Object.values(byKey);
  blocks.forEach((b) => { b.exemptUsed = b.exemptUsed.map(({ item, ...rest }) => rest); }); // JSON-safe (no RegExp / identity refs)
  const totals = blocks.reduce((a, b) => ({ authored: a.authored + b.authored, editable: a.editable + b.editable, dead: a.dead + b.dead, duplicated: a.duplicated + b.duplicated, exempt: a.exempt + b.exempt }), { authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0 });
  return { blocks, totals };
}

// --strict: exemptions in use that are block-granular (not `all`) or name no category.
export function strictFindings({ blocks }) {
  const out = [];
  blocks.forEach((b) => (b.exemptUsed || []).forEach((u) => {
    if (u.all) return;
    if (u.granular) out.push(`${b.block}: \`@ew-exempt ${u.raw}\` swallowed ${u.count} text(s) with no <tag> or /regex/ — declare the items (\`@ew-exempt <p> /^\\d/ — derived: …\`) or \`all\``);
    else if (!u.category) out.push(`${b.block}: \`@ew-exempt ${u.raw}\` (${u.count} text(s)) names no category — one of ${EW_EXEMPT_CATEGORIES.join('|')}`);
  }));
  return out;
}

export function formatRequests(requests) {
  if (!requests) return [];
  const a = Object.entries(requests.aborted || {}); const m = Object.entries(requests.missing || {});
  if (!a.length && !m.length) return [];
  const out = ['\n  harness requests — other origins aborted, paths not under the root 404 (a helper that fetched one of these returned null):'];
  a.forEach(([u, n]) => out.push(`    aborted  ${u} ×${n}`));
  m.forEach(([p, n]) => out.push(`    404      ${p} ×${n}`));
  return out;
}

export function formatTable(label, { blocks, totals }, { sim = null, verbose = false, errors = [], requests = null, strict = null } = {}) {
  const out = [];
  out.push(`\n${label}  authored=${totals.authored} editable=${totals.editable} dead=${totals.dead} duplicated=${totals.duplicated} exempt=${totals.exempt}`);
  out.push(`block            authored editable dead dup exempt drift${sim ? '  editDrift blockΔh' : ''}`);
  blocks.forEach((b) => out.push(`${b.block.padEnd(16)} ${String(b.authored).padStart(8)} ${String(b.editable).padStart(8)} ${String(b.dead).padStart(4)} ${String(b.duplicated).padStart(3)} ${String(b.exempt).padStart(6)} ${String(b.textDrift).padStart(5)}${sim ? `  ${String(b.editDrift ?? 0).padStart(9)} ${String(b.blockHeightDelta ?? 0).padStart(7)}` : ''}`));
  if (errors.length) { out.push('\n  ⚠ decorate errors (survey not trustworthy for these blocks):'); errors.forEach((e) => out.push(`    ${e}`)); }
  out.push(...formatRequests(requests));
  if (strict && strict.length) { out.push('\n  ✗ --strict: exemptions that must be declared item-level:'); strict.forEach((f) => out.push(`    ${f}`)); }
  if (verbose) {
    blocks.filter((b) => b.deadItems.length).forEach((b) => { out.push(`\n  DEAD in ${b.block}:`); b.deadItems.forEach((d) => out.push(`    ${d.label}`)); });
    blocks.filter((b) => b.dupItems.length).forEach((b) => { out.push(`\n  DUPLICATED in ${b.block}:`); b.dupItems.forEach((d) => out.push(`    ${d.label}`)); });
    blocks.filter((b) => b.exemptItems.length).forEach((b) => { out.push(`\n  EXEMPT in ${b.block} (${b.exemptReasons.join('; ')}):`); b.exemptItems.forEach((d) => out.push(`    ${d.label} [${d.category || 'no category'}]`)); });
    if (sim) blocks.filter((b) => b.driftItems?.length).forEach((b) => { out.push(`\n  EDIT-MODE DRIFT in ${b.block}:`); b.driftItems.forEach((d) => out.push(`    ${d}`)); });
  }
  return out.join('\n');
}

// Gate verdict over aggregated blocks: dead non-exempt text or duplicated index → fail.
export function verdict({ blocks }) {
  return { dead: blocks.some((b) => b.dead > 0), duplicated: blocks.some((b) => b.duplicated > 0) };
}

// Quick-edit CSS for --simulate-editor; degrades to '' offline.
export async function fetchQuickEditCss() {
  return fetch(QE_CSS).then((r) => (r.ok ? r.text() : '')).catch(() => '');
}

// ── the harness page: a synthetic origin served from the repo root ──
export const HARNESS_ORIGIN = 'http://ew.harness';
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8', map: 'application/json' };

// Open a page at http://ew.harness/__ew__.html whose document is `html` and whose
// other requests are fulfilled from `root` by a route intercept (no port opened):
// real `import('/blocks/<n>/<n>.js')` resolves aem.js, helpers and sibling blocks
// exactly as the served site would. Requests to any other origin are aborted and
// counted (`requests.aborted`), paths missing under the root 404 and are counted
// (`requests.missing`) — both are printed, so a helper that fetched one of them
// and returned null cannot silently pass. `fragments` (a content dir) serves
// `/x.plain.html` from `<fragments>/x.html`'s <main> (through `transformFragment`
// when given) for loadFragment()-driven blocks. Returns { page, ctx, requests, root, close }.
export async function openHarness(browser, { html, root = process.cwd(), width = 1440, height = 1000, fragments = null, transformFragment = null }) {
  const rootAbs = path.resolve(root);
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const requests = { aborted: {}, missing: {} };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== HARNESS_ORIGIN) { requests.aborted[url.href] = (requests.aborted[url.href] || 0) + 1; return route.abort(); }
    const p = decodeURIComponent(url.pathname);
    if (p === '/__ew__.html') return route.fulfill({ status: 200, contentType: MIME.html, body: html });
    if (fragments && p.endsWith('.plain.html')) {
      const f = path.join(fragments, `${p.slice(0, -'.plain.html'.length)}.html`);
      if (fs.existsSync(f)) {
        const m = fs.readFileSync(f, 'utf8').match(/<main>([\s\S]*?)<\/main>/);
        const body = m ? m[1] : '';
        return route.fulfill({ status: 200, contentType: MIME.html, body: transformFragment ? transformFragment(body) : body });
      }
    }
    const file = path.resolve(rootAbs, `.${p}`);
    if (file.startsWith(rootAbs + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).slice(1).toLowerCase();
      return route.fulfill({ status: 200, contentType: MIME[ext] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    requests.missing[p] = (requests.missing[p] || 0) + 1;
    return route.fulfill({ status: 404, contentType: MIME.txt, body: `not under the harness root: ${p}` });
  });
  await page.goto(`${HARNESS_ORIGIN}/__ew__.html`, { waitUntil: 'load' });
  return { page, ctx, requests, root: rootAbs, close: () => ctx.close() };
}

// Install each block's JS as a REAL module — `window.__b[name] = (await
// import('/blocks/<n>/<n>.js')).default` on the harness origin, so module-scope
// imports resolve against the root. Returns [{ name, error }] for the blocks that
// did not install (an unresolvable specifier is a 404 → the import rejects; a
// syntax error; no default export). CSS-only blocks are skipped.
export async function installBlockJs(page, names, blocksDir, { root } = {}) {
  const rootAbs = path.resolve(root || path.dirname(path.resolve(blocksDir)));
  const specs = names
    .filter((n) => fs.existsSync(path.join(blocksDir, n, `${n}.js`)))
    .map((n) => ({ name: n, url: `/${path.relative(rootAbs, path.resolve(blocksDir, n, `${n}.js`)).split(path.sep).join('/')}` }));
  return page.evaluate(async (list) => {
    window.__b = window.__b || {};
    const failed = [];
    for (const { name, url } of list) {
      try {
        const mod = await import(url);
        if (typeof mod.default !== 'function') { failed.push({ name, error: `${url} has no default export function (decorate)` }); continue; }
        window.__b[name] = mod.default;
      } catch (e) { failed.push({ name, error: `${e.message} [${url}]` }); }
    }
    return failed;
  }, specs);
}

// One line per uninstalled block, with the 404s that explain an import failure.
export function installErrors(notInstalled, requests, root) {
  const missing = Object.keys((requests && requests.missing) || {}).filter((p) => /\.m?js$/.test(p));
  return notInstalled.map(({ name, error }) => `${name}: block JS failed to install — ${error}${missing.length ? `; unresolved under the harness root ${root}: ${missing.join(', ')}` : ''} — fix the import specifier (or pass --root), or verify this block via the dev-server harness + Step 10`);
}

// Run decorate() over every .<name> element; returns "<name>: <error>" strings.
export async function runDecorate(page, names) {
  return page.evaluate(async (ns) => {
    const out = [];
    for (const n of ns) {
      if (!window.__b || !window.__b[n]) continue;
      for (const el of document.querySelectorAll(`.${n}`)) {
        try { await window.__b[n](el); } catch (e) { out.push(`${n}: ${e.message}`); }
      }
    }
    return out;
  }, names);
}

// Harness mode: decorate an authored content file locally and survey it.
// Returns { texts, rows, sim, names, errors, page, ctx, requests, root, pipeline } —
// the page is left open (screenshots / further evaluation); the caller closes `ctx`.
export async function probeContent(browser, { content, blocksDir, stylesPath, root = null, width = 1440, simulate = false, extraCss = '', instrumentFirst = true, pipeline = true, styleSplit = 'comma', fragments = null }) {
  let mainHtml = readMainHtml(content);
  let counts = null;
  const bodyCls = ['appear'];
  if (pipeline) {
    // The delivered shape first (section-metadata applied, <p><picture>, hoists…):
    // tagging, instrumentation, runtimeMimic and decode all face what the preview
    // host will serve. template/theme rows become body classes as decorateTemplateAndTheme would.
    const r = pipelineMimic(mainHtml, { styleSplit });
    mainHtml = r.html; counts = r.counts;
    ['template', 'theme'].forEach((k) => { if (r.meta[k]) bodyCls.push(r.meta[k].toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')); });
  }
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const rootDir = root || path.dirname(path.resolve(blocksDir));
  // body.appear satisfies the vanilla foundation's body{display:none} gate the
  // way loadEager() does; body > header is hidden so sticky headers do not land
  // in tall element screenshots.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}body > header{display:none}${styles}\n${extraCss}</style></head><body class="${bodyCls.join(' ')}"><main>${mainHtml}</main></body></html>`;
  const h = await openHarness(browser, { html, root: rootDir, width, height: 1000, fragments, transformFragment: pipeline ? (frag) => pipelineMimic(frag, { styleSplit }).html : null });
  const { page } = h;
  await page.evaluate(dropMetadata);
  const names = await page.evaluate(discoverBlocks);
  const blockCss = names.map((n) => { try { return fs.readFileSync(path.join(blocksDir, n, `${n}.css`), 'utf8'); } catch { return ''; } }).join('\n');
  if (blockCss) await page.addStyleTag({ content: blockCss });
  await page.evaluate(runtimeMimic);
  const texts = instrumentFirst ? (await page.evaluate(instrument, EDITABLE)).texts : [];
  const errors = [];
  const notInstalled = await installBlockJs(page, names, blocksDir, { root: rootDir });
  errors.push(...installErrors(notInstalled, h.requests, h.root));
  errors.push(...await runDecorate(page, names));
  await page.waitForTimeout(800);
  const rows = await page.evaluate(survey, texts);
  let sim = null;
  if (simulate) {
    const css = await fetchQuickEditCss();
    if (css) await page.addStyleTag({ content: css });
    sim = await page.evaluate(simulateEditor, texts);
  }
  return { texts, rows, sim, names, errors, page, ctx: h.ctx, requests: h.requests, root: h.root, pipeline: counts ? formatCounts(counts) : 'pipeline emulation: off (--no-pipeline)' };
}

// URL mode: intercept the document response, instrument it in a scratch page,
// let the served page's own scripts decorate, survey. Returns { texts, rows, sim, page, ctx }.
export async function probeUrl(browser, url, { width = 1440, simulate = false, settleMs = 500, timeoutMs = 30000, waitUntil = 'networkidle', gotoTimeoutMs = 45000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const scratch = await ctx.newPage();
  const page = await ctx.newPage();
  let texts = [];
  let instrumented = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    // The main-frame document only (the first navigation, or its redirect target).
    if (req.resourceType() !== 'document' || req.frame() !== page.mainFrame() || instrumented) return route.continue();
    instrumented = true;
    const resp = await route.fetch();
    const html = await resp.text();
    await scratch.setContent(html);
    const out = await scratch.evaluate(instrument, EDITABLE);
    texts = out.texts;
    return route.fulfill({ response: resp, body: out.html, headers: { ...resp.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await page.goto(url, { waitUntil, timeout: gotoTimeoutMs });
  await page.waitForFunction(() => [...document.querySelectorAll('main .section')].every((s) => s.dataset.sectionStatus === 'loaded'), null, { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(settleMs);
  const rows = await page.evaluate(survey, texts);
  let sim = null;
  if (simulate) {
    const css = await fetchQuickEditCss();
    if (css) await page.addStyleTag({ content: css });
    sim = await page.evaluate(simulateEditor, texts);
  }
  return { texts, rows, sim, page, ctx };
}

// Where a global `npm i -g playwright` lands, derived without spawning `npm root -g`
// (a shell per lint run): STARDUST_PLAYWRIGHT_ROOT (a node_modules dir), then npm's
// prefix (npm_config_prefix when npm runs us, else the directory above the node
// binary — nvm/volta/homebrew/official installers all keep lib/node_modules there;
// Windows keeps node_modules beside node.exe). Only existing directories are returned.
export function globalNodeModulesCandidates({ env = process.env, execPath = process.execPath, exists = fs.existsSync } = {}) {
  const bin = path.dirname(execPath);
  const prefixes = [env.npm_config_prefix, path.resolve(bin, '..'), bin].filter(Boolean);
  const dirs = [env.STARDUST_PLAYWRIGHT_ROOT, ...prefixes.flatMap((pre) => [path.join(pre, 'lib', 'node_modules'), path.join(pre, 'node_modules')])].filter(Boolean);
  return [...new Set(dirs)].filter((d) => exists(d));
}

// Resolve playwright from the cwd project first (plugin scripts live outside any
// node_modules tree), then bare, then a global install (no shell spawned).
export async function loadChromium({ roots = globalNodeModulesCandidates() } = {}) {
  const normalize = (mod) => (mod.chromium ? mod : (mod.default?.chromium ? mod.default : null));
  const fromRoot = async (dir) => normalize(await import(pathToFileURL(createRequire(path.join(dir, 'noop.js')).resolve('playwright')).href));
  // the resolution chain first (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md § Resolution chain):
  // plugin layout, then a project copy made as a set; the inline links below serve a lone copy without it
  for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) {
    let chain = null;
    try { chain = await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
    if (chain) { try { const mod = normalize(await chain.resolveDep('playwright', { from: import.meta.url })); if (mod) return mod.chromium; } catch { break; } }
  }
  for (const dir of [process.cwd(), path.join(process.cwd(), 'stardust')]) { // cwd, then stardust/node_modules (preflight-runtime.mjs)
    try { const mod = await fromRoot(dir); if (mod) return mod.chromium; } catch { /* next link */ }
  }
  try {
    const mod = normalize(await import('playwright'));
    if (mod) return mod.chromium;
  } catch { /* fall through */ }
  for (const dir of roots) {
    try {
      const mod = await fromRoot(dir);
      if (mod) return mod.chromium;
    } catch { /* next candidate */ }
  }
  throw new Error('playwright not found — run node skills/stardust/scripts/preflight-runtime.mjs (master § Setup step 10)');
}

// One launch to learn whether a browser BINARY exists behind a resolvable playwright
// (a bare `npm i playwright` ships no Chromium): null when it does, else the reason —
// tests self-skip on it instead of failing.
export async function browserUnavailable(chromium) {
  if (!chromium) return 'playwright is not resolvable (project, bare or global)';
  try { const b = await chromium.launch(); await b.close(); return null; } catch (e) { return `chromium cannot launch: ${String(e.message || e).split('\n')[0].slice(0, 160)}`; }
}

// ──────────────────────────────────────────────────────────────── CLI ──

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { json: false, verbose: false, simulate: false, exempt: new Set(), content: null, blocksDir: null, styles: null, root: null, width: 1440, urls: [], strict: false, pipeline: true, styleSplit: 'comma', help: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--json') opts.json = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--simulate-editor') opts.simulate = true;
    else if (a === '--exempt') opts.exempt = parseExemptList(rest[i += 1]);
    else if (a === '--content') opts.content = rest[i += 1];
    else if (a === '--blocks-dir') opts.blocksDir = rest[i += 1];
    else if (a === '--styles') opts.styles = rest[i += 1];
    else if (a === '--width') opts.width = Number(rest[i += 1]);
    else if (a === '--root') opts.root = rest[i += 1];
    else if (a === '--strict') opts.strict = true;
    else if (a === '--no-pipeline') opts.pipeline = false;
    else if (a === '--style-split') opts.styleSplit = rest[i += 1];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.urls.push(a);
  }
  return opts;
}

const USAGE = 'usage: ew-editability-probe.mjs <url> [<url> ...] [--json] [--verbose] [--simulate-editor] [--exempt a,b] [--blocks-dir dir] [--strict]\n'
  + '       ew-editability-probe.mjs --content <content/page.html> [--blocks-dir dir] [--root dir] [--styles css] [--width px] [--json] [--verbose] [--simulate-editor] [--exempt a,b] [--strict] [--no-pipeline] [--style-split comma|first-only]\n';

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { process.stdout.write(USAGE); process.exit(0); }
  if ((!opts.urls.length && !opts.content) || !['comma', 'first-only'].includes(opts.styleSplit)) { process.stderr.write(USAGE); process.exit(2); }
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const results = [];
  let fail = false;
  let probeError = false;
  try {
    if (opts.content) {
      const blocksDir = opts.blocksDir || firstExisting(['eds/blocks', 'blocks'], 'blocks dir');
      const stylesPath = opts.styles || firstExisting(['eds/styles/styles.css', 'styles/styles.css'], 'styles.css');
      const { rows, sim, names, errors, ctx, requests, root, pipeline } = await probeContent(browser, { content: opts.content, blocksDir, stylesPath, root: opts.root, width: opts.width, simulate: opts.simulate, pipeline: opts.pipeline, styleSplit: opts.styleSplit });
      await ctx.close();
      const exemptions = readBlockExemptions(blocksDir, names, opts.exempt);
      const agg = aggregate(rows, { sim, exemptions });
      const v = verdict(agg);
      const strict = opts.strict ? strictFindings(agg) : [];
      if (v.dead || v.duplicated || strict.length) fail = true;
      if (errors.length) probeError = true;
      // no verdict ≠ FAIL: a probe error with no dead/duplicated count is `unmeasured` (update-coverage --gate editability reads this field; rollout Gate 6)
      results.push({ content: opts.content, blocksDir, stylesPath, root, pipeline, totals: agg.totals, blocks: agg.blocks, rows, sim, exemptions, errors, requests, strict, unmeasured: errors.length > 0 && !(v.dead || v.duplicated) });
      if (!opts.json) console.log(`${pipeline}\n${formatTable(`${opts.content} (harness, ${blocksDir}, ${stylesPath}, root ${root})`, agg, { sim, verbose: opts.verbose || opts.strict, errors, requests, strict })}`);
    }
    for (const url of opts.urls) {
      const { rows, sim, ctx } = await probeUrl(browser, url, { width: opts.width, simulate: opts.simulate });
      await ctx.close();
      const names = [...new Set(rows.map((r) => r.block))];
      const exemptions = readBlockExemptions(opts.blocksDir, names, opts.exempt);
      const agg = aggregate(rows, { sim, exemptions });
      const v = verdict(agg);
      const strict = opts.strict ? strictFindings(agg) : [];
      if (v.dead || v.duplicated || strict.length) fail = true;
      results.push({ url, totals: agg.totals, blocks: agg.blocks, rows, sim, exemptions, strict, unmeasured: false });
      if (!opts.json) console.log(formatTable(url, agg, { sim, verbose: opts.verbose || opts.strict, strict }));
    }
  } catch (e) { console.error(e); process.exit(2); } finally { await browser.close(); }
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  if (probeError) { console.error('probe error: some blocks failed to install/decorate — their survey is not trustworthy'); process.exit(2); }
  process.exit(fail ? 1 : 0);
}

const isCli = process.argv[1] && path.basename(process.argv[1]) === 'ew-editability-probe.mjs';
if (isCli) main().catch((e) => { console.error(e); process.exit(2); });
