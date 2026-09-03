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
 *      selectors survive it (deploy SKILL.md § Experience Workspace editability
 *      contract, EW2).
 *
 * Two modes:
 *   URL mode (served page, the page's own scripts.js decorates):
 *     node ew-editability-probe.mjs <url> [<url> ...] [--json] [--verbose] [--simulate-editor]
 *         [--exempt a,b] [--blocks-dir <dir>]
 *   Harness mode (no server — the render-harness/block-roundtrip inline-decorate
 *   technique: <main> from the content file, styles.css + block CSS inlined, the
 *   runtime's decorateButtons/decorateSections/decorateBlock/wrapTextNodes DOM
 *   mimicked, block JS inlined and decorate() run per block):
 *     node ew-editability-probe.mjs --content <content/page.html> [--blocks-dir <dir>]
 *         [--styles <css>] [--width <px>] [--json] [--verbose] [--simulate-editor] [--exempt a,b]
 *     defaults: --blocks-dir eds/blocks then blocks; --styles eds/styles/styles.css then styles/styles.css
 *
 * Exemptions (EW5 — exempt text is declared, not silently dropped):
 *   --exempt a,b            CLI fallback: blocks whose authored rows are config /
 *                           derived / index fallback (still reported, excluded from
 *                           the exit code)
 *   @ew-exempt <reason>     JSDoc tag in <blocksDir>/<name>/<name>.js (leading
 *                           comment). Any tag exempts the block's dead texts (they
 *                           are reported as `exempt`, with the declared reasons);
 *                           `@ew-exempt all` = the whole block is index/API-driven.
 *                           Read whenever a blocks dir is known (harness mode
 *                           always; URL mode with --blocks-dir). Union with --exempt.
 *   metadata / section-metadata cells are pipeline config (never displayed) and
 *   are not counted at all.
 *
 * Exit code 0 = every non-exempt authored text editable and no duplicated index,
 * 1 = dead non-exempt text OR duplicated index, 2 = probe error (including a
 * block whose JS failed to install/decorate in harness mode — an undecorated
 * block's raw rows would false-pass).
 *
 * The in-page functions (runtimeMimic, instrument, survey, simulateEditor) and
 * the exemption/aggregation helpers are EXPORTED so block-roundtrip.mjs,
 * render-harness.mjs and the qa `editability` check measure with the same
 * instrument. Importing this module does not run the CLI and does not load
 * playwright (the CLI resolves it lazily from the cwd project, then bare).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus, no-continue, no-param-reassign */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

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

// @ew-exempt tags in the LEADING JSDoc of a block's JS. Returns null when the
// block declares nothing, else { all, reasons: [...], categories: [...] }.
export function parseExemptTags(js) {
  const lead = (js.match(/^\s*\/\*\*([\s\S]*?)\*\//) || [])[1];
  if (!lead) return null;
  const reasons = [...lead.matchAll(/@ew-exempt\s+([^\n]*)/g)].map((m) => m[1].replace(/^\*\s*/, '').trim()).filter(Boolean);
  if (!reasons.length) return null;
  const all = reasons.some((r) => /^all\b/i.test(r));
  const categories = EW_EXEMPT_CATEGORIES.filter((c) => reasons.some((r) => new RegExp(`\\b${c}\\b`, 'i').test(r)));
  return { all, reasons, categories };
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
    if (out[name]) out[name].reasons = [...out[name].reasons, '--exempt (CLI)'];
    else out[name] = { all: false, reasons: ['--exempt (CLI)'], categories: [], source: '--exempt' };
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
    const b = byKey[key] ??= { block: key, authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0, textDrift: 0, deadItems: [], dupItems: [], exemptItems: [], exemptReasons: ex ? ex.reasons : [] };
    b.authored += 1;
    const label = `<${r.tag}> ${r.text}`;
    if (r.hits === 1) { b.editable += 1; if (!r.sameText) b.textDrift += 1; }
    else if (r.hits > 1) { b.duplicated += 1; b.editable += 1; b.dupItems.push({ tag: r.tag, text: r.text, hits: r.hits, label: `${label} (×${r.hits})` }); }
    else if (ex) { b.exempt += 1; b.exemptItems.push({ tag: r.tag, text: r.text, label }); }
    else { b.dead += 1; b.deadItems.push({ tag: r.tag, text: r.text, label }); }
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
  const totals = blocks.reduce((a, b) => ({ authored: a.authored + b.authored, editable: a.editable + b.editable, dead: a.dead + b.dead, duplicated: a.duplicated + b.duplicated, exempt: a.exempt + b.exempt }), { authored: 0, editable: 0, dead: 0, duplicated: 0, exempt: 0 });
  return { blocks, totals };
}

export function formatTable(label, { blocks, totals }, { sim = null, verbose = false, errors = [] } = {}) {
  const out = [];
  out.push(`\n${label}  authored=${totals.authored} editable=${totals.editable} dead=${totals.dead} duplicated=${totals.duplicated} exempt=${totals.exempt}`);
  out.push(`block            authored editable dead dup exempt drift${sim ? '  editDrift blockΔh' : ''}`);
  blocks.forEach((b) => out.push(`${b.block.padEnd(16)} ${String(b.authored).padStart(8)} ${String(b.editable).padStart(8)} ${String(b.dead).padStart(4)} ${String(b.duplicated).padStart(3)} ${String(b.exempt).padStart(6)} ${String(b.textDrift).padStart(5)}${sim ? `  ${String(b.editDrift ?? 0).padStart(9)} ${String(b.blockHeightDelta ?? 0).padStart(7)}` : ''}`));
  if (errors.length) { out.push('\n  ⚠ decorate errors (survey not trustworthy for these blocks):'); errors.forEach((e) => out.push(`    ${e}`)); }
  if (verbose) {
    blocks.filter((b) => b.deadItems.length).forEach((b) => { out.push(`\n  DEAD in ${b.block}:`); b.deadItems.forEach((d) => out.push(`    ${d.label}`)); });
    blocks.filter((b) => b.dupItems.length).forEach((b) => { out.push(`\n  DUPLICATED in ${b.block}:`); b.dupItems.forEach((d) => out.push(`    ${d.label}`)); });
    blocks.filter((b) => b.exemptItems.length).forEach((b) => { out.push(`\n  EXEMPT in ${b.block} (${b.exemptReasons.join('; ')}):`); b.exemptItems.forEach((d) => out.push(`    ${d.label}`)); });
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

// Inline each block's JS into the harness page as window.__b[name] (export
// default stripped; the default export must be `decorate`). Returns the names
// whose JS failed to install (module-scope import/export, syntax error).
export async function installBlockJs(page, names, blocksDir) {
  const withJs = [];
  for (const name of names) {
    let js;
    try { js = fs.readFileSync(path.join(blocksDir, name, `${name}.js`), 'utf8'); } catch { continue; } // CSS-only block
    withJs.push(name);
    await page.addScriptTag({ content: `window.__b=window.__b||{};window.__b[${JSON.stringify(name)}]=(function(){${js.replace(/export default\s+/, '')}\nreturn decorate;})();` });
  }
  return page.evaluate((ns) => ns.filter((n) => !(window.__b && window.__b[n])), withJs);
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
// Returns { texts, rows, sim, names, errors, page } — the page is left open
// (screenshots / further evaluation) for the caller to close.
export async function probeContent(browser, { content, blocksDir, stylesPath, width = 1440, simulate = false, extraCss = '', instrumentFirst = true }) {
  const mainHtml = readMainHtml(content);
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  // body.appear satisfies the vanilla foundation's body{display:none} gate the
  // way loadEager() does; body > header is hidden so sticky headers do not land
  // in tall element screenshots.
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}body > header{display:none}${styles}\n${extraCss}</style></head><body class="appear"><main>${mainHtml}</main></body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(dropMetadata);
  const names = await page.evaluate(discoverBlocks);
  const blockCss = names.map((n) => { try { return fs.readFileSync(path.join(blocksDir, n, `${n}.css`), 'utf8'); } catch { return ''; } }).join('\n');
  if (blockCss) await page.addStyleTag({ content: blockCss });
  await page.evaluate(runtimeMimic);
  const texts = instrumentFirst ? (await page.evaluate(instrument, EDITABLE)).texts : [];
  const errors = [];
  const notInstalled = await installBlockJs(page, names, blocksDir);
  notInstalled.forEach((n) => errors.push(`${n}: block JS failed to install — module-scope import/export or a syntax error (the harness inlines block JS and cannot resolve imports)`));
  errors.push(...await runDecorate(page, names));
  await page.waitForTimeout(800);
  const rows = await page.evaluate(survey, texts);
  let sim = null;
  if (simulate) {
    const css = await fetchQuickEditCss();
    if (css) await page.addStyleTag({ content: css });
    sim = await page.evaluate(simulateEditor, texts);
  }
  return { texts, rows, sim, names, errors, page };
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

// Resolve playwright from the cwd project first (plugin scripts live outside any
// node_modules tree), then bare.
export async function loadChromium() {
  const normalize = (mod) => (mod.chromium ? mod : (mod.default?.chromium ? mod.default : null));
  try {
    const req = createRequire(path.join(process.cwd(), 'package.json'));
    const mod = normalize(await import(pathToFileURL(req.resolve('playwright')).href));
    if (mod) return mod.chromium;
  } catch { /* fall through */ }
  const mod = normalize(await import('playwright'));
  if (!mod) throw new Error('playwright not found: run from a project that has it installed (npm i -D playwright)');
  return mod.chromium;
}

// ──────────────────────────────────────────────────────────────── CLI ──

function parseArgs(argv) {
  const rest = argv.slice(2);
  const opts = { json: false, verbose: false, simulate: false, exempt: new Set(), content: null, blocksDir: null, styles: null, width: 1440, urls: [] };
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
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.urls.push(a);
  }
  return opts;
}

const USAGE = 'usage: ew-editability-probe.mjs <url> [<url> ...] [--json] [--verbose] [--simulate-editor] [--exempt a,b] [--blocks-dir dir]\n'
  + '       ew-editability-probe.mjs --content <content/page.html> [--blocks-dir dir] [--styles css] [--width px] [--json] [--verbose] [--simulate-editor] [--exempt a,b]\n';

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.urls.length && !opts.content) { process.stderr.write(USAGE); process.exit(2); }
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const results = [];
  let fail = false;
  let probeError = false;
  try {
    if (opts.content) {
      const blocksDir = opts.blocksDir || firstExisting(['eds/blocks', 'blocks'], 'blocks dir');
      const stylesPath = opts.styles || firstExisting(['eds/styles/styles.css', 'styles/styles.css'], 'styles.css');
      const { rows, sim, names, errors, page } = await probeContent(browser, { content: opts.content, blocksDir, stylesPath, width: opts.width, simulate: opts.simulate });
      await page.close();
      const exemptions = readBlockExemptions(blocksDir, names, opts.exempt);
      const agg = aggregate(rows, { sim, exemptions });
      const v = verdict(agg);
      if (v.dead || v.duplicated) fail = true;
      if (errors.length) probeError = true;
      results.push({ content: opts.content, blocksDir, stylesPath, totals: agg.totals, blocks: agg.blocks, rows, sim, exemptions, errors });
      if (!opts.json) console.log(formatTable(`${opts.content} (harness, ${blocksDir}, ${stylesPath})`, agg, { sim, verbose: opts.verbose, errors }));
    }
    for (const url of opts.urls) {
      const { rows, sim, ctx } = await probeUrl(browser, url, { width: opts.width, simulate: opts.simulate });
      await ctx.close();
      const names = [...new Set(rows.map((r) => r.block))];
      const exemptions = readBlockExemptions(opts.blocksDir, names, opts.exempt);
      const agg = aggregate(rows, { sim, exemptions });
      const v = verdict(agg);
      if (v.dead || v.duplicated) fail = true;
      results.push({ url, totals: agg.totals, blocks: agg.blocks, rows, sim, exemptions });
      if (!opts.json) console.log(formatTable(url, agg, { sim, verbose: opts.verbose }));
    }
  } catch (e) { console.error(e); process.exit(2); } finally { await browser.close(); }
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  if (probeError) { console.error('probe error: some blocks failed to install/decorate — their survey is not trustworthy'); process.exit(2); }
  process.exit(fail ? 1 : 0);
}

const isCli = process.argv[1] && path.basename(process.argv[1]) === 'ew-editability-probe.mjs';
if (isCli) main().catch((e) => { console.error(e); process.exit(2); });
