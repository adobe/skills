#!/usr/bin/env node
/**
 * skills/reskin/scripts/stream-render.mjs — the generic Phase 4 renderer: any captured content model ×
 * any donor token sheet (Figma or URL donor) × one per-site mapping.json → a reskinned page.
 *
 * Every visible string, href and image URL is interpolated from content-model.json (never retyped);
 * every surface value is a CSS custom property generated from donor-tokens.json (each string leaf,
 * path-named: type.display.fontWeight → --type-display-font-weight; a missing token falls back to a
 * neutral default). Output follows the renderer contract the gates and the canon bridge read:
 * .site-header / .site-main / .site-footer (data-canon="header|footer", data-template on main), one
 * <section data-slot="sNN" [data-module]> per content-model slot with its stream in [data-slot-body],
 * page resets in :where() so a lifted canon never outranks block CSS, the primary button `.btn` inside
 * main (2nd+ button of a slot: `.btn btn-secondary`), heading alignment from type.display.textAlign
 * (default left). An unknown stream node kind throws — extend the renderer, never drop content.
 *
 * Images are hot-linked to the source by default (the gates compare host+path). --localize-images
 * downloads each one to <dir>/prototypes/assets/img/<host>/<path> (the migrate bundler's root; a query
 * becomes a short hash on the file name so image-proxy URLs stay distinct), copies it beside the page as
 * <out dir>/assets/img/<host>/<path> and writes src="assets/img/<host>/<path>": the one ref form both a
 * browser opening the page (the local gates) and migrate's bundler with its default --proto-dir resolve
 * (its `assets/` prefix → <proto-dir>/assets/img/…), since the page and the proto dir sit at different
 * depths. It keeps data-source-src="<original>" — dom-equality and slot-coverage match on it, so the gates
 * hold on a localized page. A failed download (or two URLs landing on one local file) keeps the remote
 * src and is listed.
 *
 * mapping.json (the only per-site input; schema and defaults: reference/mapping-json.md):
 *   { "chrome": { "model": "<dir holding a content-model.json>", "header": ["s01"], "footer": ["s03"], "footerTone": "dark|light|accent",
 *       "navAlign": "start|center|end" },
 *     "blocks": { "M2": "<eds block name>" },   (optional; read by --deploy-map only, default the id lower-cased)
 *     "pages": { "<slug>": { "template": "<archetype slug>",
 *       "slots": { "s01": { "module": "M2", "layout": "stack|grid-2|media-band|split|cards (space-separated)",
 *         "width": "narrow|wide", "tone": "dark|light|accent", "columns": 3,
 *         "heading": "display|h2|h3|h4", "inset": "80px", "split": "531px 1fr", "bleed": true,
 *         "align": "center" } } } } }
 *   chrome.navAlign: where a branded header row (logo + menu list) puts its menu between the logo and the
 *   actions; an override of the donor's layout.navAlign (a Figma donor's curate measures it), default end.
 *   layout stack: the stream in order; grid-2: form fields two-up; media-band: the slot's first image as a
 *   cover backdrop behind a panel; split: the first image beside the text; cards: the stream's repeating
 *   run (findRepeat — same node-kind sequence back to back, heading levels ignored when that covers more,
 *   e.g. image+h3+p per team member; or 2+ list items each holding an image or link and text, one card
 *   per item) as a grid of
 *   cards, `columns` wide (default 3 when the count divides by 3, else 2), intro above and tail below.
 *   tone paints the panel from palette.darkBandBg/Fg, lightBandBg or accent ("bleed": true paints the
 *   whole full-width band instead, for frames whose tone band spans the viewport); align: center centres
 *   the stream (cards keep start alignment); a split whose image precedes its heading puts it first.
 *   Sub-headings take their donor type role (role-h4/h5) when the donor has it. Content-driven, never per
 *   site: 3+ consecutive images render as one logo row; h2–h4 take type.h2–h4 sizes when the donor has
 *   them; a slot's leading heading in the h2 role (an h2 with no heading option, or heading: h2) sits on an
 *   accent label when the donor has radii.label; a label's required marker takes type.required's weight when the
 *   donor has that role (else the label's). heading picks the
 *   type role of the slot's .heading (default display) when the frame sets the title smaller; inset
 *   replaces the centred container with a full-width one and that side gutter (a frame padded from the
 *   viewport edge, not centred); split sets the split layout's two column tracks (px | fr | %) where the
 *   frame's text column is not half the row. Card titles take type.h3 whatever their level (the
 *   source keeps its h2/h3; the donor's card title is one role). The style opens with the token-contract :root block (render/root-tokens,
 *   M2b D10) that figma-gate's ramp asserts, then the flattened donor variables. --max-width is the
 *   content width (the container pads outside it, as a Figma container does); grid-2, split and cards
 *   share layout.columnGap (default 40px).
 *
 * Usage:
 *   node stream-render.mjs <slug> [--dir stardust] [--mapping <dir>/reskin/mapping.json]
 *     [--model-dir <dir>/reskin/content-model] [--out <dir>/reskin/pages/<slug>.html] [--localize-images] [--register]
 *     --register (flow "reskin" only; any other flow is exit 2 before rendering) records the page in
 *     <dir>/state.json through skills/stardust/scripts/state.mjs (history + _provenance writtenBy
 *     stardust:reskin): prototypePath = --out relative to the project root (the parent of --dir), so
 *     reskin-ledger, canon-from-reskin, preflight and migrate find it; an extracted/directed page advances
 *     to prototyped — a sibling of a type with an approved/migrated archetype only to directed, the status
 *     migrate renders at the sibling tier; a page at prototyped or later keeps its status. A slug not in
 *     state.json is rendered and noted, not registered.
 *   node stream-render.mjs --check [<slug>…] [--dir stardust] [--mapping <f>] [--model-dir <d>]
 *     validates mapping.json (reference/mapping-json.md): unknown keys, values outside the enums above,
 *     slot ids the page's content model lacks, requested slugs without a pages entry — one problem per
 *     line on stdout, nothing rendered or written; exit 0 valid, 1 problems, 2 setup error.
 *   node stream-render.mjs <slug> --deploy-map [--dir stardust] [--mapping <f>] [--model-dir <d>]
 *     prints deploy's block-roundtrip arguments for the page (the deployed leg, reference/deployed-leg.md):
 *     `--map '<block>=section[data-slot="sNN"],…'`, one per block, instances in page order. The block is
 *     mapping.json blocks.<module id> when set, else the module id lower-cased; slots with no module are
 *     listed on stderr. Nothing rendered or written.
 *
 * Reads:  <dir>/reskin/content-model/<slug>/content-model.json, <dir>/reskin/donor-tokens.json,
 *         the mapping, the chrome model when mapped.
 * Writes: --out (parent dirs created); with --localize-images also <dir>/prototypes/assets/img/** and
 *         <out dir>/assets/img/**;
 *         with --register <dir>/state.json.
 * Exit:   0 rendered, 1 render error (unknown node kind, label round-trip), 2 setup error.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rootTokens } from './render/root-tokens.mjs';

const HELP = `usage: node stream-render.mjs <slug> [--dir stardust] [--mapping <file>] [--model-dir <d>] [--out <file>]
         [--localize-images] [--register]
       node stream-render.mjs --check [<slug>…] [--dir stardust] [--mapping <file>] [--model-dir <d>]
       node stream-render.mjs <slug> --deploy-map [--dir stardust] [--mapping <file>] [--model-dir <d>]

Render one page from <dir>/reskin/content-model/<slug>/content-model.json with the donor tokens in
<dir>/reskin/donor-tokens.json and the slot mapping in <dir>/reskin/mapping.json.
  --dir <d>            stardust state dir (default stardust)
  --mapping <file>     mapping.json (default <dir>/reskin/mapping.json; schema: reference/mapping-json.md)
  --model-dir <d>      content models (default <dir>/reskin/content-model)
  --out <file>         output HTML (default <dir>/reskin/pages/<slug>.html); --register hands it to
                       the ledger, the canon bridge and migrate
  --localize-images    download images to <dir>/prototypes/assets/img/ (migrate's root), copy them to
                       <out dir>/assets/img/, src="assets/img/…", keep data-source-src
  --register           record the page in <dir>/state.json through state.mjs (flow "reskin" only, else
                       exit 2 before rendering): prototypePath = --out relative to the project root;
                       extracted/directed → prototyped, or → directed for a sibling of a type that has
                       an approved archetype (migrate's sibling tier); later statuses keep their status
  --deploy-map         print block-roundtrip's --map arguments for <slug>: one block per mapped module
                       (mapping.json blocks.<module>, else the module id lower-cased), its
                       section[data-slot] instances in page order; nothing rendered or written
  --check              validate mapping.json only (unknown keys, bad values, slots missing from the
                       content model, requested <slug>s without a page entry): one problem per line on
                       stdout; renders and writes nothing. Exit 0 valid, 1 problems, 2 setup error.
Exit 0 rendered, 1 render error, 2 setup error.`;

class SetupError extends Error {}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const url = (n) => esc(n.absHref || n.href);
const SKIP = new Set(['donor', 'curatedFrom', 'note', 'nodeRefs', 'coverage', 'motifs', '_provenance', 'familyNote']);

// Every string leaf of the donor sheet becomes a path-named CSS custom property (type.display.fontWeight →
// --type-display-font-weight). Pure; exported for tests.
export function tokenVars(tokens) {
  const vars = [];
  (function walk(o, path) {
    for (const [k, val] of Object.entries(o || {})) {
      if (SKIP.has(k)) continue;
      const p = [...path, k];
      if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, p);
      else if (typeof val === 'string') vars.push([`--${p.join('-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`, val]);
    }
  })(tokens, []);
  return vars;
}

// Which top-level stream nodes render as a `.btn` (the donor primary/secondary button): a cta whose classes
// say button or that capture saw styled as one (buttonLike), a submit/button form control, a bare text run
// inside a <button>. Exported so donor-probe can tell "this page has no button" from "the renderer broke
// the .btn convention".
export const isButtonish = (n) => n?.kind === 'cta' && (!!n.buttonLike || /\b(btn|button)\b/i.test(n.classes || ''));
export const rendersButton = (n) => isButtonish(n)
  || (n?.kind === 'formControl' && /submit|button/.test(n.inputType || ''))
  || (n?.kind === 'text' && (n.parentTag === 'button' || !!n.inButton));
export const modelHasButton = (model) => (model?.sections || []).some((s) => (s.ordered || []).some(rendersButton));

// The repeating run of a slot's ordered stream — the items of a card grid, team, process list. A node's
// signature is its kind (+ heading level, + parent class for bare text); the run is the start/period whose
// signature sequence repeats back to back, covering the most nodes (ties: the later start, then the smaller period).
// Nodes before it are the intro, nodes after it the tail. Null when nothing repeats twice. Pure; exported.
// Card titles often carry drifting heading levels in a design file (h3/h4/h5 for visually equal titles), so a
// level-blind run wins when it covers more of the stream than the level-exact one.
// A source card list (ul > li, each li an image/link + text) is one listItem node per card: a run of 2+ such
// structured listItems is the run, period 1, when it covers at least as much as any node-level run.
export function findRepeat(ordered, opts = {}) {
  const exact = repeatRun(ordered, opts, true);
  const loose = repeatRun(ordered, opts, false);
  const best = !loose || (exact && exact.covered >= loose.covered) ? exact : loose;
  const items = itemRun(ordered, opts);
  if (items && (!best || items.count >= best.covered)) return withBounds(items);
  const anchored = anchorRun(ordered, opts);
  if (anchored && (!best || anchored.covered > best.covered)) return anchored;
  return best && withBounds({ start: best.start, period: best.period, count: best.count });
}
const withBounds = (r) => ({ ...r, bounds: Array.from({ length: r.count + 1 }, (_, k) => r.start + k * r.period) });
// A listing whose items share an opening (image + heading, or a heading of one level) but differ in how many
// paragraphs follow: each item runs from one opening to the next. The last item keeps only the body kinds the
// others carry, so a trailing stray node stays in the tail. Three or more items; bounds are item start indices.
function anchorRun(ordered, { maxStart = 6 } = {}) {
  const sig = ordered.map((n) => `${n.kind}:${n.level || ''}`);
  let best = null;
  for (let start = 0; start <= Math.min(maxStart, sig.length - 6); start++) {
    for (const plen of [2, 1]) {
      const head = sig.slice(start, start + plen);
      if (plen === 1 && !/^heading:/.test(head[0])) continue;
      if (plen === 2 && !/^(image|heading):/.test(head[0])) continue;
      const at = (i) => head.every((h, j) => sig[i + j] === h);
      const starts = [];
      for (let i = start; i < sig.length; i++) if (at(i)) starts.push(i);
      if (starts.length < 3) continue;
      const bodies = new Set();
      for (let k = 0; k + 1 < starts.length; k++) sig.slice(starts[k] + plen, starts[k + 1]).forEach((x) => bodies.add(x));
      if ([...bodies].some((x) => x === head[0] || /^heading:/.test(x))) continue;
      const maxLen = Math.max(...starts.slice(1).map((x, k) => x - starts[k]));
      let end = starts[starts.length - 1] + plen;
      while (end < sig.length && bodies.has(sig[end]) && end - starts[starts.length - 1] < maxLen) end++;
      const covered = end - starts[0];
      if (!best || covered > best.covered) best = { start: starts[0], count: starts.length, covered, bounds: [...starts, end] };
    }
  }
  return best;
}
export const isCardItem = (n) => n?.kind === 'listItem' && (n.children || []).length >= 2
  && n.children.some((c) => c.kind === 'image' || c.kind === 'cta');
function itemRun(ordered, { maxStart = 6 } = {}) {
  let best = null;
  for (let start = 0; start <= Math.min(maxStart, ordered.length - 2); start++) {
    let count = 0;
    while (isCardItem(ordered[start + count])) count++;
    if (count >= 2 && (!best || count > best.count)) best = { start, period: 1, count };
  }
  return best;
}
function repeatRun(ordered, { maxStart = 6, maxPeriod = 12 } = {}, levels = true) {
  const sig = ordered.map((n) => [n.kind, levels ? n.level || '' : '', n.kind === 'text' ? n.parentClass || n.parentTag || '' : ''].join(':'));
  let best = null;
  for (let start = 0; start <= Math.min(maxStart, sig.length - 4); start++) {
    for (let period = 2; period <= maxPeriod && start + 2 * period <= sig.length; period++) {
      let count = 1;
      while (start + (count + 1) * period <= sig.length
        && sig.slice(start, start + period).every((s, j) => s === sig[start + count * period + j])) count++;
      if (count < 2) continue;
      const covered = count * period;
      // Tie on coverage: the run that ends nearer the stream's end (a shifted run drags an intro node into
      // item 1 and leaves the last item's tail outside), then the smaller period.
      const better = !best || covered > best.covered
        || (covered === best.covered && (start > best.start || (start === best.start && period < best.period)));
      if (better) best = { start, period, count, covered };
    }
  }
  return best;
}

// WCAG contrast of two CSS colours (#rgb, #rrggbb, rgb()/rgba()); null when either is unparseable.
export function contrast(a, b) {
  const rgb = (c) => {
    const s = String(c || '').trim();
    let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    return m ? m.slice(1, 4).map(Number) : null;
  };
  const lum = (c) => {
    const [r, g, bl] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = rgb(a); const y = rgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// Pure: one page's HTML. resolveImg(url) → { src, source? } lets the CLI localize; the default hot-links.
// Visible text leaves of a chrome section (punctuation-only fragments aside) absent from its rendered HTML.
// The content gates measure <main> only, so render() throws on any: a chrome drop never ships silently.
export function chromeTextMissing(section, html) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const rendered = norm(String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  const leaves = [];
  const walk = (n) => {
    const kids = (n.children || []).filter((c) => norm(c.text));
    if (kids.length) kids.forEach(walk);
    else if (n.kind !== 'image' && /[\p{L}\p{N}]/u.test(norm(n.text))) leaves.push(norm(n.text));
  };
  (section.ordered || []).forEach(walk);
  return leaves.filter((t) => !rendered.includes(t));
}

export function render({ slug, model, tokens, mapping, chromeModel = null, now = new Date().toISOString(), resolveImg = (u) => ({ src: u }) }) {
  const pageMap = mapping?.pages?.[slug];
  if (!pageMap) throw new SetupError(`mapping.json has no pages.${slug}`);
  const vars = tokenVars(tokens);
  const has = (name) => vars.some(([n]) => n === name);
  const v = (name, fallback) => (has(name) ? `var(${name})` : fallback);
  // The optional contract tokens (render/root-tokens: --card-*, --button-height, --section-padding-mobile, --gutter-mobile)
  // sit in the first :root block, the one canon keeps; absent, the literal fallback renders as before.
  const rootNames = new Set(rootTokens(tokens).entries.map((e) => e.name));
  const r = (name, fallback) => (rootNames.has(name) ? `var(${name})` : fallback);
  const val = (name) => vars.find(([n]) => n === name)?.[1];
  // An accent that fails 4.5:1 on the light grounds it sits on stays a decoration, never the text colour.
  const accentRatios = ['--palette-page-bg', '--palette-light-band-bg'].map((g) => contrast(val('--palette-accent'), val(g) ?? (g === '--palette-page-bg' ? '#fff' : null))).filter((r) => r != null);
  const accentText = !has('--palette-accent') || !accentRatios.length || Math.min(...accentRatios) >= 4.5;
  const images = [];
  const img = (u) => {
    if (u && !images.includes(u)) images.push(u);
    const r = resolveImg(u || '');
    return `src="${esc(r.src)}"${r.source ? ` data-source-src="${esc(r.source)}"` : ''}`;
  };
  let uid = 0;
  const warnings = [];

  // ---- the ordered stream → HTML -----------------------------------------------------------------------
  // A trailing required marker ("Email *", "Email*") is styled, never edited; the parse must round-trip.
  function labelHtml(text) {
    const m = text.match(/^(.*?)(\s?)\*$/);
    const out = m ? `${esc(m[1])}${m[2]}<span class="req">*</span>` : esc(text);
    if (unesc(out) !== text) throw new Error(`label parse lost text: ${JSON.stringify(text)}`);
    return out;
  }
  function controlHtml(n, id) {
    const name = n.name ? ` name="${esc(n.name)}"` : '';
    if (n.control === 'select') {
      const opts = Array.isArray(n.options) ? n.options : String(n.text || '').split('\n');
      return `<select id="${id}"${name}>${opts.map((o) => `<option>${esc(typeof o === 'string' ? o : o.text)}</option>`).join('')}</select>`;
    }
    if (n.control === 'textarea') return `<textarea id="${id}"${name}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''}>${esc(n.text)}</textarea>`;
    const type = n.inputType || 'text';
    const val = n.value && /checkbox|radio|submit|button/.test(type) ? ` value="${esc(n.value)}"` : '';
    return `<input id="${id}" type="${esc(type)}"${name}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''}${val}>`;
  }
  // An icon-font ligature is drawn as its glyph (its word stays in the DOM for the byte gate, at font-size 0);
  // visually hidden source text (sr-only, skip links) stays visually hidden.
  const GLYPHS = [[/search/, 'search'], [/close|clear/, 'close'], [/menu/, 'menu'], [/left|back/, 'left'], [/up|less/, 'up'], [/down|expand_more|more/, 'down'], [/./, 'right']];
  const glyphHtml = (t) => `<span class="glyph glyph-${GLYPHS.find(([re]) => re.test(t))[1]}" aria-hidden="true">${esc(t)}</span>`;
  // A model captured before glyph flagging: a single lowercase word in an icon-font span is still a glyph.
  const isGlyphLeaf = (n) => n.glyph || (n.kind === 'text' && /material-(icons|symbols)|\bicons?\b/i.test(n.parentClass || '') && /^[a-z_]+$/.test((n.text || '').trim()));
  function leafHtml(n) {
    if (isGlyphLeaf(n)) return glyphHtml(n.text);
    if (n.srOnly) return `<span class="sr-only">${txt(n)}</span>`;
    return txt(n);
  }
  const toggleId = (n) => n.toggle || (n.kind === 'heading' ? n.children?.find((c) => c.toggle)?.toggle : null) || null;
  function inlineHtml(nodes) {
    return nodes.map((n) => {
      const sep = n.sep ?? '';
      if (n.kind === 'cta') return `${sep}<a class="link${n.srOnly ? ' sr-only' : ''}" href="${url(n)}">${n.children ? inlineHtml(n.children) : txt(n)}</a>`;
      // An image inside a link or paragraph (arrow, social badge) is content: it stays, inline; a content-sized
      // one (rendered ≥ 200px wide) keeps its size.
      if (n.kind === 'image') return `${sep}<img class="${n.rw >= 200 ? 'inline-media' : 'icon'}" ${img(n.currentSrc || n.src)} alt="${esc(n.alt)}">`;
      if (n.children) return `${sep}${inlineHtml(n.children)}`;
      return `${sep}${leafHtml(n)}`;
    }).join('');
  }
  function tableHtml(n, ctx) {
    const rows = (n.rows || []).map((r) => `<tr>${r.map((c) => {
      const tag = c.header ? 'th' : 'td';
      return `<${tag}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}>${c.children ? streamHtml(c.children, ctx) : esc(c.text)}</${tag}>`;
    }).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table class="table"><tbody>${rows}</tbody></table></div>`;
  }
  // Figma-sourced text (content-model.md § Figma-sourced models): the model's text is the rendered case;
  // the page carries the design's characters with the case as CSS, so innerText equals text and the
  // markup keeps what the designer typed. A truncated string is kept whole and clamped in CSS.
  const CASE_CSS = { UPPER: 'text-transform: uppercase', LOWER: 'text-transform: lowercase', TITLE: 'text-transform: capitalize', SMALL_CAPS: 'font-variant-caps: small-caps', SMALL_CAPS_FORCED: 'font-variant-caps: all-small-caps' };
  function txt(n, text = n.text) {
    const cased = n.characters != null && CASE_CSS[n.textCase] ? `<span class="tc" style="${CASE_CSS[n.textCase]}">${esc(n.characters)}</span>` : esc(text);
    const lines = Number.isInteger(n.truncation?.maxLines) && n.truncation.maxLines > 0 ? n.truncation.maxLines : null;
    return lines ? `<span class="clamp" style="-webkit-line-clamp: ${lines}">${cased}</span>` : cased;
  }
  // The first button of a slot is primary; later ones take the donor's secondary spec (when it exists).
  const btnClass = (ctx) => (ctx.buttons++ === 0 ? 'btn' : 'btn btn-secondary');
  function streamHtml(ordered, ctx) {
    const out = [];
    for (let i = 0; i < ordered.length; i++) {
      const n = ordered[i]; const next = ordered[i + 1];
      // A disclosure (toggle + the panel it controls) keeps the source's rest state: closed, the panel is
      // hidden="until-found" (findable, and revealed by dom-equality before it reads the text). The toggle is
      // the stream node itself or the button inside a heading (h3 > button).
      const tid = toggleId(n);
      if (tid) {
        const title = []; let j = i;
        while (ordered[j] && toggleId(ordered[j]) === tid) title.push(ordered[j++]);
        const panel = [];
        while (ordered[j] && (ordered[j].panels || []).includes(tid)) panel.push(ordered[j++]);
        if (panel.length) {
          i = j - 1;
          const pid = `disclosure-${++uid}`; const open = title.some((t) => t.toggleOpen || t.children?.some((c) => c.toggleOpen));
          out.push(`<div class="disclosure"><button class="disclosure-toggle" type="button" aria-expanded="${open}" aria-controls="${pid}">${title.map((t, k) => `${k ? t.sep ?? ' ' : ''}${t.children ? inlineHtml(t.children) : leafHtml(t)}`).join('')}</button><div class="disclosure-panel" id="${pid}"${open ? '' : ' hidden="until-found"'}>${streamHtml(panel, ctx)}</div></div>`);
          continue;
        }
      }
      switch (n.kind) {
        case 'table': out.push(tableHtml(n, ctx)); break;
        case 'heading': {
          // A sub-heading whose donor type role differs from display is sized by that role, so drifting DOM
          // levels (h3/h4/h5 on visually equal card titles) render alike.
          const r = /^h[2-6]$/.test(n.role || '') && has(`--type-${n.role}-font-size`) ? ` role-${n.role}` : '';
          out.push(`<${n.level || 'h2'} class="heading${r}">${txt(n)}</${n.level || 'h2'}>`); break;
        }
        case 'paragraph':
          // A paragraph holding only images, one of them content-sized, is a figure (a model captured
          // before 0.41 has no rw and keeps the inline-icon rendering).
          if (n.children?.length && n.children.every((c) => c.kind === 'image') && n.children.some((c) => c.rw >= 200)) {
            out.push(...n.children.map((c) => `<figure class="media media-wide"><img ${img(c.currentSrc || c.src)} alt="${esc(c.alt)}"></figure>`)); break;
          }
          out.push(`<p class="${n.children?.some((c) => c.kind === 'cta') ? 'aux' : 'lead'}">${n.children ? inlineHtml(n.children) : txt(n)}</p>`); break;
        case 'listItem': {
          const items = [n]; while (ordered[i + 1]?.kind === 'listItem') items.push(ordered[++i]);
          out.push(`<ul class="list">${items.map((li) => `<li>${li.children ? inlineHtml(li.children) : txt(li)}</li>`).join('')}</ul>`); break;
        }
        case 'cta':
          out.push(isButtonish(n) ? `<div class="actions"><a class="${btnClass(ctx)}" href="${url(n)}">${n.children?.some((c) => c.kind === 'image') ? inlineHtml(n.children) : txt(n)}</a></div>`
            : `<p class="aux"><a class="link" href="${url(n)}">${n.children ? inlineHtml(n.children) : txt(n)}</a></p>`); break;
        case 'image': {
          if ((ctx.band || ctx.split) && !ctx.bandImage) { ctx.bandImage = n; break; }
          // A run of 3+ bare images (partner logos, badges) is one row, not a column of figures.
          const run = [n]; while (ordered[i + run.length]?.kind === 'image') run.push(ordered[i + run.length]);
          if (run.length >= 3) {
            out.push(`<div class="logos">${run.map((im) => `<img ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('')}</div>`);
            i += run.length - 1;
          } else out.push(`<figure class="media"><img ${img(n.currentSrc || n.src)} alt="${esc(n.alt)}"></figure>`);
          break;
        }
        case 'formControl': {
          const id = `f${++uid}`;
          if (/checkbox|radio/.test(n.inputType || '') && next && (next.kind === 'text' || next.kind === 'cta')) {
            const lab = next.kind === 'cta' ? `<a class="link" href="${url(next)}">${txt(next)}</a>` : txt(next);
            out.push(`<div class="check">${controlHtml(n, id)}<label for="${id}">${lab}</label></div>`); i++;
          } else if (/submit|button/.test(n.inputType || '')) out.push(`<div class="actions"><button class="${btnClass(ctx)}" type="submit">${esc(n.value || n.text)}</button></div>`);
          else out.push(`<div class="field">${controlHtml(n, id)}</div>`);
          break;
        }
        case 'text':
          if (n.parentTag === 'label' && next?.kind === 'formControl' && !/checkbox|radio/.test(next.inputType || '')) {
            const id = `f${++uid}`; out.push(`<div class="field"><label for="${id}">${n.textCase ? txt(n) : labelHtml(n.text)}</label>${controlHtml(next, id)}</div>`); i++;
          } else if (n.parentTag === 'button' || n.inButton) out.push(`<div class="actions"><button class="${btnClass(ctx)}" type="submit">${txt(n)}</button></div>`);
          else if (isGlyphLeaf(n) || n.srOnly) out.push(leafHtml(n));
          else out.push(`<p class="text">${txt(n)}</p>`);
          break;
        default: throw new Error(`unhandled stream node kind "${n.kind}" in ${slug} — extend stream-render, never drop content`);
      }
    }
    return out.join('\n        ');
  }

  // ---- chrome (donor shell carrying the source's links: a declared delta, outside the content gate) -----
  // Header nav in source order: links, plus link-less list items (menu triggers such as a mega-menu
  // parent) as labelled triggers — dropping them loses visible source text.
  function navItems(s) {
    if (!Array.isArray(s.ordered) || !s.ordered.length) return s.ctas.map((c) => `<a href="${url(c)}">${esc(c.text)}</a>`);
    return s.ordered.flatMap((n) => navItem(s, n));
  }

  function navItem(s, n) {
    const ctasIn = (x) => (x.kind === 'cta' ? [x] : (x.children || []).flatMap(ctasIn));
    const links = ctasIn(n).filter((c) => (c.text || '').trim());
    if (links.length) return links.map((c) => `<a${c.srOnly ? ' class="sr-only"' : ''} href="${url(c)}">${c.children ? inlineHtml(c.children.filter((k) => k.kind !== 'image').map((k) => ({ ...k, kind: k.kind === 'cta' ? 'text' : k.kind }))) : esc(c.text)}</a>`);
    const text = (n.text || '').trim();
    if (!text || n.kind === 'image') return [];
    // a Figma-only capture lists its links as ctas and their text as plain stream nodes
    const cta = s.ctas.find((c) => (c.text || '').trim() === text);
    if (cta) return [`<a href="${url(cta)}">${esc(text)}</a>`];
    if (n.kind === 'listItem') return [`<button class="nav-menu" type="button" aria-expanded="false">${esc(text)}</button>`];
    if (n.glyph || n.srOnly) return [leafHtml(n)];
    return [`<span class="nav-text">${esc(text)}</span>`];
  }

  // A branded row (logo + a menu list) is three zones in source order: brand, the menu (its list items)
  // and the actions (the links outside it, e.g. a Login button). Other rows stay one link run.
  function headerRow(s) {
    const logos = s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('');
    const ordered = Array.isArray(s.ordered) ? s.ordered : [];
    const hasList = ordered.some((n) => n.kind === 'listItem');
    const isAction = (n) => n.inButton || n.parentTag === 'button';
    if (!logos || (!hasList && !ordered.some(isAction))) {
      return `<div class="chrome-row"><div class="container">
      ${logos}
      <nav>${navItems(s).join('')}</nav>
    </div></div>`;
    }
    // Without a menu list the menu is the row's plain entries and the actions its buttons (a Figma frame).
    const inMenu = (n) => (hasList ? n.kind === 'listItem' : !isAction(n));
    const menu = ordered.filter(inMenu).flatMap((n) => navItem(s, n));
    let btn = 0;
    // A source button stays a button: its link (or, without one, a <button>) takes the donor's button paint.
    const actions = ordered.filter((n) => !inMenu(n)).flatMap((n) => {
      const items = navItem(s, n);
      if (!isAction(n)) return items;
      const cls = () => (btn++ === 0 ? 'btn btn-secondary' : 'btn');
      if (!items.length) return [];
      return items.map((h) => (h.startsWith('<a ') ? h.replace('<a ', `<a class="${cls()}" `)
        : n.glyph || n.srOnly ? `<button class="${n.glyph ? 'icon-btn' : 'sr-only'}" type="button">${leafHtml(n)}</button>` : `<button class="${cls()}" type="button">${esc((n.text || '').trim())}</button>`));
    });
    const navAlign = mapping.chrome?.navAlign ?? tokens.layout?.navAlign;
    const align = ['start', 'center', 'end'].includes(navAlign) ? navAlign : 'end';
    // The row's plain (non-link) texts are the brand's name and tagline: they sit with the logo, as a
    // Figma header's brand zone does, not among the actions.
    const brandTexts = actions.filter((h) => h.startsWith('<span class="nav-text">'));
    // An action link whose label is only screen-reader text (a government/parent-org link whose mark was not
    // captured) is the Figma header's utility bar: shown as a small text link above the row on desktop.
    const isUtil = (h) => /^<a [^>]*>(<span class="sr-only">[^<]*<\/span>)+<\/a>$/.test(h);
    const util = actions.filter(isUtil).map((h) => h.replace(/<span class="sr-only">([^<]*)<\/span>/g, '$1'));
    const rest = actions.filter((h) => !brandTexts.includes(h) && !isUtil(h));
    const brand = `<div class="brand">${logos}${brandTexts.length ? `<div class="brand-text">${brandTexts.join('')}</div>` : ''}</div>`;
    // The toggle opens the folded menu below 900px: the page script flips aria-expanded and .nav-open on the header.
    const toggle = menu.length ? '<button class="icon-btn nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><span class="glyph glyph-menu" aria-hidden="true"></span></button>' : '';
    return `${util.length ? `<div class="utility-bar"><div class="container">${util.join('')}</div></div>` : ''}<div class="chrome-row nav-align-${align}"><div class="container">
      ${brand}
      <nav${toggle ? ' id="site-nav"' : ''}>${menu.join('')}</nav>
      <div class="nav-actions">${rest.join('')}${toggle}</div>
    </div></div>`;
  }

  // Footer prose in source order: every non-link text leaf (headings, text runs, list items), so a
  // contact block or a credit line is never dropped; links go to the link list.
  function footerTexts(s) {
    const ctaTexts = new Set(s.ctas.map((c) => (c.text || '').trim()));
    if (!Array.isArray(s.ordered) || !s.ordered.length) {
      return [...s.paragraphs, ...(s.listItems || [])].map((p) => (typeof p === 'string' ? p : p.text)).filter((t) => !ctaTexts.has(t));
    }
    const out = [];
    const walk = (n) => {
      if (n.kind === 'cta' || n.kind === 'image' || n.kind === 'formControl') return;
      const kids = (n.children || []).filter((c) => (c.text || '').trim());
      if (kids.length) { kids.forEach(walk); return; }
      const t = (n.text || '').trim();
      if (t && /[\p{L}\p{N}]/u.test(t) && !ctaTexts.has(t) && !out.includes(t)) out.push(t);
    };
    s.ordered.forEach(walk);
    return out;
  }

  // A footer whose stream has headings is laid out in zones, as a Figma footer is: the brand (logos, the
  // top-level heading and the prose), one column per titled run of list items (an untitled run is its own
  // column), and a social row (a heading with no list of its own, beside the icon links).
  function footerZones(s) {
    const ordered = Array.isArray(s.ordered) ? s.ordered : [];
    const heads = ordered.filter((n) => n.kind === 'heading');
    if (!heads.length || !ordered.some((n) => n.kind === 'listItem')) return null;
    const lvl = (n) => Number(String(n.level || 'h6').slice(1)) || 6;
    const top = Math.min(...heads.map(lvl));
    const brand = []; const cols = []; let social = null; let col = null;
    const leaf = (n) => (n.children?.length ? inlineHtml(n.children) : esc((n.text || '').trim()));
    for (let i = 0; i < ordered.length; i += 1) {
      const n = ordered[i];
      if (n.kind === 'heading') {
        col = null;
        if (lvl(n) === top && !brand.some((b) => b.startsWith('<p class="footer-name"'))) { brand.push(`<p class="footer-name">${leaf(n)}</p>`); continue; }
        const next = ordered.slice(i + 1).find((m) => m.kind !== 'image');
        if (next?.kind === 'listItem') { col = { title: leaf(n), items: [] }; cols.push(col); continue; }
        social = leaf(n); continue;
      }
      if (n.kind === 'listItem') {
        if (!col) { col = { title: null, items: [] }; cols.push(col); }
        col.items.push(`<li>${leaf(n)}</li>`); continue;
      }
      col = null;
      if (n.kind === 'image' || (n.kind === 'cta' && !(n.text || '').trim())) continue;
      if (n.kind === 'cta') { cols.push({ title: null, items: [`<li><a href="${url(n)}">${leaf(n)}</a></li>`] }); continue; }
      if ((n.text || '').trim()) brand.push(`<p class="footer-prose">${leaf(n)}</p>`);
    }
    const logos = s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('');
    const icons = (s.iconLinks || []).map((c) => `<li><a href="${url(c)}" aria-label="${esc(c.label)}">${esc(c.label)}</a></li>`).join('');
    return `<div class="container chrome-footer footer-zoned">
      <div class="footer-main"><div class="footer-brand">${logos}${brand.join('')}</div>
      ${cols.map((c) => `<div class="footer-col">${c.title ? `<p class="footer-col-title">${c.title}</p>` : ''}<ul>${c.items.join('')}</ul></div>`).join('\n      ')}</div>
      ${social || icons ? `<div class="footer-social">${social ? `<p class="footer-social-label">${social}</p>` : ''}${icons ? `<ul class="icon-links">${icons}</ul>` : ''}</div>` : ''}
    </div>`;
  }

  // Every visible text leaf of a chrome section must survive the render: the content gates measure
  // <main> only, so a silent drop here would ship unnoticed.
  function assertChromeText(s, html) {
    const missing = chromeTextMissing(s, html);
    if (missing.length) {
      throw new Error(`chrome ${s.slot} dropped visible text ${JSON.stringify(missing)} in ${slug} — extend stream-render, never drop content`);
    }
  }

  function chromeHtml(ids, role) {
    if (!chromeModel) return '';
    const slots = ids.map((id) => chromeModel.sections.find((s) => s.slot === id)).filter(Boolean);
    const checked = (s, html) => { assertChromeText(s, html); return html; };
    if (role === 'header') {
      return slots.map((s) => checked(s, headerRow(s))).join('\n  ');
    }
    return slots.map((s) => checked(s, (() => {
      const zoned = footerZones(s);
      if (zoned) return zoned;
      const texts = footerTexts(s);
      return `<div class="container chrome-footer">
      <div>${s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('')}${texts.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      <ul>${s.ctas.map((c) => `<li><a href="${url(c)}">${esc(c.text)}</a></li>`).join('')}</ul>${(s.iconLinks || []).length ? `
      <ul class="icon-links">${s.iconLinks.map((c) => `<li><a href="${url(c)}" aria-label="${esc(c.label)}">${esc(c.label)}</a></li>`).join('')}</ul>` : ''}
    </div>`;
    })())).join('\n  ');
  }

  // ---- page -------------------------------------------------------------------------------------------
  // A runtime embed the normalize step removed (dynamics disposition: embed) still occupies space on the live page:
  // hold that space with a neutral placeholder after the section whose heading the ledger names.
  const embedAfter = new Set((model._provenance?.normalize?.ledger || [])
    .filter((e) => /disposition:\s*embed/i.test(e.why || '') && /embed/i.test(e.what || ''))
    .map((e) => (e.what.match(/under\s+["“]([^"”]+)["”]/) || [])[1]?.trim().toLowerCase()).filter(Boolean));
  const sections = model.sections.map((s, i) => {
    const m = pageMap.slots?.[s.slot] || {};
    const layout = (m.layout || 'stack').split(/\s+/);
    const ctx = { band: layout.includes('media-band'), split: layout.includes('split'), bandImage: null, buttons: 0 };
    let inner;
    const rep = layout.includes('cards') ? findRepeat(s.ordered) : null;
    if (rep) {
      const end = rep.bounds[rep.count];
      const items = Array.from({ length: rep.count }, (_, k) => s.ordered.slice(rep.bounds[k], rep.bounds[k + 1]));
      const cols = Number.isInteger(m.columns) && m.columns > 0 ? m.columns : (rep.count % 3 === 0 ? 3 : 2);
      inner = [
        streamHtml(s.ordered.slice(0, rep.start), ctx),
        `<div class="cards" style="--cards-columns: ${cols}">${items.map((it) => `<div class="card">${streamHtml(it.length === 1 && isCardItem(it[0]) ? it[0].children : it, { ...ctx, band: false, split: false })}</div>`).join('')}</div>`,
        streamHtml(s.ordered.slice(end), ctx),
      ].filter(Boolean).join('\n        ');
    } else {
      if (layout.includes('cards')) warnings.push(`${s.slot}: layout "cards" but no repeating run in the stream — rendered as a stack`);
      inner = streamHtml(s.ordered, ctx);
    }
    const head = s.ordered.find((n) => n.kind === 'heading');
    if (head && embedAfter.has(String(head.text || '').trim().toLowerCase())) inner += '\n        <div class="embed-placeholder" aria-hidden="true"></div>';
    if (m.align && m.align !== 'center') warnings.push(`${s.slot}: unknown align "${m.align}" (center) — ignored`);
    // A split whose stream opens with its image (before any heading) keeps the image on the leading side.
    const firstImg = s.ordered.findIndex((n) => n.kind === 'image');
    const firstHead = s.ordered.findIndex((n) => n.kind === 'heading');
    const mediaFirst = ctx.split && ctx.bandImage && firstImg > -1 && (firstHead === -1 || firstImg < firstHead);
    const tone = ['dark', 'light', 'accent'].includes(m.tone) ? m.tone : null;
    if (m.tone && !tone) warnings.push(`${s.slot}: unknown tone "${m.tone}" (dark | light | accent) — ignored`);
    const role = ['display', 'h2', 'h3', 'h4'].includes(m.heading) ? m.heading : null;
    if (m.heading && !role) warnings.push(`${s.slot}: unknown heading "${m.heading}" (display | h2 | h3 | h4) — ignored`);
    if (role && role !== 'display' && !has(`--type-${role}-font-size`)) warnings.push(`${s.slot}: heading "${role}" but the donor has no type.${role} — rendered as display`);
    const inset = typeof m.inset === 'string' && /^\d+(\.\d+)?(px|rem|%)$/.test(m.inset) ? m.inset : null;
    if (m.inset && !inset) warnings.push(`${s.slot}: inset "${m.inset}" is not a length (px | rem | %) — ignored`);
    const split = typeof m.split === 'string' && /^(\d+(\.\d+)?(px|fr|%) ?){2}$/.test(m.split.trim()) ? m.split.trim() : null;
    if (m.split && !split) warnings.push(`${s.slot}: split "${m.split}" is not two column tracks (px | fr | %) — ignored`);
    const vars = [...(inset ? [`--band-inset: ${inset}`] : []), ...(split ? [`--split-columns: ${split}`] : [])];
    const cardTone = ['dark', 'light', 'accent'].includes(m.cardTone) ? m.cardTone : null;
    if (m.cardTone && !cardTone) warnings.push(`${s.slot}: unknown cardTone "${m.cardTone}" (dark | light | accent) — ignored`);
    const cls = ['band', ...layout.map((l) => `layout-${l}`), ...(cardTone ? [`cards-${cardTone}`] : []), `width-${m.width || 'narrow'}`, ...(tone ? [`tone-${tone}`] : []), ...(role ? [`heading-${role}`] : []), ...(inset ? ['inset'] : []), ...(tone && m.bleed === true ? ['bleed'] : []), ...(m.align === 'center' ? ['align-center'] : []), ...(mediaFirst ? ['media-first'] : [])].join(' ');
    const media = ctx.bandImage ? `<img class="${ctx.split ? 'split-img' : 'band-img'}" ${img(ctx.bandImage.currentSrc || ctx.bandImage.src)} alt="${esc(ctx.bandImage.alt)}">` : '';
    return `<section class="${cls}"${vars.length ? ` style="${vars.join('; ')}"` : ''} data-slot="${esc(s.slot || `s${String(i + 1).padStart(2, '0')}`)}"${m.module ? ` data-module="${esc(m.module)}"` : ''}>
      ${ctx.split ? '' : media}
      <div class="container"><div class="panel"><div class="flow" data-slot-body>
          ${inner}
      </div>${ctx.split ? media : ''}</div></div>
    </section>`;
  });
  const md = model.metadata || {};
  // A key the model declares absent (a Figma-sourced page has no description) is not emitted, not even empty.
  const declaredAbsent = new Set(md.declaredAbsent || []);
  const metaTags = [
    md.description != null && !declaredAbsent.has('description') ? `<meta name="description" content="${esc(md.description)}">` : '',
    md.canonical ? `<link rel="canonical" href="${esc(md.canonical)}">` : '',
    ...Object.entries(md.ogTags || {}).map(([k, val]) => `<meta property="${esc(k)}" content="${esc(val)}">`),
    ...Object.entries(md.twitterTags || {}).map(([k, val]) => `<meta name="${esc(k)}" content="${esc(val)}">`),
    ...(md.jsonLd || []).map((j) => `<script type="application/ld+json">${typeof j === 'string' ? j : JSON.stringify(j)}</script>`),
    md.favicon ? `<link rel="icon" href="${esc(md.favicon)}">` : '',
  ].filter(Boolean).join('\n');

  const css = `${rootTokens(tokens).css.trimEnd()}
  :root {
  ${vars.map(([n, val]) => `  ${n}: ${val};`).join('\n')}
  }
  :where(.site-header, .site-main, .site-footer), :where(.site-header, .site-main, .site-footer) *, :where(.site-header, .site-main, .site-footer) *::before, :where(.site-header, .site-main, .site-footer) *::after { box-sizing: border-box; }
  body:has(> .site-header, > .site-main, > .site-footer) { margin: 0; background: ${v('--palette-page-bg', '#fff')}; color: ${v('--palette-body-fg', 'inherit')}; font-family: ${v('--type-family', 'sans-serif')}; font-size: ${v('--type-body-font-size', '16px')}; line-height: ${v('--type-body-line-height', '1.5')}; }
  .site-main .embed-placeholder { position: relative; height: 440px; margin-top: 48px; background: ${v('--palette-light-band-bg', '#eee')}; }
  .site-main .embed-placeholder::after { content: ""; position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: ${v('--palette-accent', '#888')}; }
  @media (max-width: 640px) { .site-main .embed-placeholder { height: 280px; margin-top: 32px; } }
  .site-main .clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
  .container { box-sizing: content-box; max-width: ${v('--layout-container-max-width', '1200px')}; margin: 0 auto; padding: ${v('--layout-container-padding', '0 24px')}; }
  :where(.site-header, .site-main, .site-footer) a { color: inherit; }
  .link { ${accentText ? `color: ${v('--palette-accent', 'inherit')}; text-decoration: underline;` : `color: inherit; text-decoration: underline; text-decoration-color: var(--palette-accent); text-decoration-thickness: 2px; text-underline-offset: 3px;`} }
  :where(.site-header, .site-main, .site-footer) img { max-width: 100%; height: auto; }
  .site-header .chrome-row { border-bottom: 1px solid ${v('--palette-light-band-bg', '#eee')}; }
  .site-header .chrome-row .container { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 56px; flex-wrap: wrap; }
  .site-header nav { display: flex; gap: 16px; flex-wrap: wrap; margin-left: auto; }
  .site-header nav a { text-decoration: none; }
  .site-header nav { align-items: center; }
  .site-header .nav-menu { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  .site-header .nav-menu::after { content: ""; width: 6px; height: 6px; border: solid currentcolor; border-width: 0 1.5px 1.5px 0; transform: translateY(-2px) rotate(45deg); }
  .site-header .nav-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .site-header .nav-align-start nav { margin-left: 0; }
  .site-header .nav-align-start .nav-actions { margin-left: auto; }
  @media (min-width: 900px) {
    .site-header .nav-align-center .container { display: grid; grid-template-columns: 1fr auto 1fr; }
    .site-header .nav-align-center .logo { grid-column: 1; justify-self: start; }
    .site-header .nav-align-center nav { grid-column: 2; margin-left: 0; justify-content: center; }
    .site-header .nav-align-center .nav-actions { grid-column: 3; justify-self: end; }
  }
  .logo { height: 32px; width: auto; }
  .site-main section { position: relative; padding-top: ${v('--layout-section-padding-y', '64px')}; padding-bottom: ${v('--layout-section-padding-y', '64px')}; }
  .site-main .layout-media-band { background: ${v('--palette-light-band-bg', 'transparent')}; overflow: hidden; }
  .site-main .band-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .site-main .panel { position: relative; }
  .site-main .layout-media-band .panel { background: ${v('--palette-page-bg', '#fff')}; border-radius: ${v('--radii-card', '0')}; padding: 40px; }
  .site-main .width-narrow .panel { max-width: 550px; }
  .site-main .layout-grid-2 .flow { display: grid; grid-template-columns: 1fr 1fr; column-gap: ${v('--layout-column-gap', '40px')}; }
  .site-main .layout-grid-2 .flow > :not(.field) { grid-column: 1 / -1; }
  .site-main h1, .site-main h2, .site-main h3, .site-main h4 { font-family: ${v('--type-display-font-family', 'inherit')}; font-weight: ${v('--type-display-font-weight', '700')}; color: ${v('--palette-heading-fg', 'inherit')}; margin: 0 0 24px; }
  .site-main .heading { font-size: ${v('--type-display-font-size', '2em')}; line-height: ${v('--type-display-line-height', '1.2')}; text-align: ${v('--type-display-text-align', 'left')}; }
  ${['h2', 'h3', 'h4'].filter((h) => has(`--type-${h}-font-size`)).map((h) => `.site-main .heading-${h} .heading { font-size: var(--type-${h}-font-size); line-height: ${v(`--type-${h}-line-height`, '1.2')}; }`).join('\n  ')}
  ${['h2', 'h3', 'h4', 'h5', 'h6'].filter((h) => has(`--type-${h}-font-size`)).map((h) => `.site-main .band .flow .heading.role-${h} { font-size: var(--type-${h}-font-size); line-height: ${v(`--type-${h}-line-height`, '1.3')}; }`).join('\n  ')}
  .site-main .heading-display .heading { font-size: ${v('--type-display-font-size', '2em')}; line-height: ${v('--type-display-line-height', '1.2')}; }
  .site-main .inset > .container { max-width: none; padding: 0 var(--band-inset); }
  ${['h2', 'h3', 'h4'].filter((h) => has(`--type-${h}-font-size`)).map((h) => `.site-main ${h}.heading { font-size: var(--type-${h}-font-size); line-height: ${v(`--type-${h}-line-height`, '1.2')}; font-weight: ${v(`--type-${h}-font-weight`, 'inherit')}; }`).join('\n  ')}
  ${has('--type-h3-font-size') ? `.site-main .card .heading { font-size: var(--type-h3-font-size); line-height: ${v('--type-h3-line-height', '1.2')}; font-weight: ${v('--type-h3-font-weight', 'inherit')}; }` : ''}
  ${has('--radii-label') ? `.site-main .band:not([class*="heading-"]) .flow > h2.heading:first-child, .site-main .heading-h2 .flow > .heading:first-child { display: inline-block; justify-self: start; background: ${v('--palette-accent', 'transparent')}; border-radius: var(--radii-label); padding: 0 7px; }` : ''}
  .site-main p { margin: 0 0 16px; }
  .site-main .field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
  .site-main .field label { font-weight: ${v('--type-label-font-weight', '600')}; }
  .site-main .req { color: ${accentText ? v('--palette-accent', 'inherit') : 'inherit'}; font-weight: ${v('--type-required-font-weight', 'inherit')}; }
  .site-main input:not([type=checkbox]):not([type=radio]), .site-main select, .site-main textarea { font: inherit; min-height: 48px; padding: 0 16px; width: 100%; border: 1px solid ${v('--palette-light-band-bg', '#ccc')}; border-radius: ${v('--radii-control', '4px')}; color: inherit; background: ${v('--palette-page-bg', '#fff')}; }
  .site-main .check { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
  .site-main .check input { flex: none; width: 20px; height: 20px; accent-color: ${v('--palette-accent', 'auto')}; }
  .site-main .actions { margin: 24px 0 0; }
  :is(.site-main, .site-header) .btn { display: inline-flex; align-items: center; justify-content: center; min-height: ${r('--button-height', '40px')}; background: ${v('--buttons-primary-background', 'currentColor')}; color: ${v('--buttons-primary-color', '#fff')}; border: ${v('--buttons-primary-border', '0')}; border-radius: ${v('--buttons-primary-border-radius', '4px')}; padding: ${v('--buttons-primary-padding', '8px 16px')}; font-family: inherit; font-size: ${v('--buttons-primary-font-size', 'inherit')}; font-weight: ${v('--buttons-primary-font-weight', '700')}; line-height: ${v('--buttons-primary-line-height', v('--type-body-line-height', 'inherit'))}; text-decoration: none; cursor: pointer; }
  :is(.site-main, .site-header) .btn-secondary { background: ${v('--buttons-secondary-background', 'transparent')}; color: ${v('--buttons-secondary-color', 'inherit')}; border: ${v('--buttons-secondary-border', '1px solid currentColor')}; }
  .site-main .width-narrow .btn { width: 100%; }

  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .glyph { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-size: 0; vertical-align: middle; }
  .glyph::before { content: ""; width: 7px; height: 7px; border: solid currentcolor; border-width: 0 2px 2px 0; }
  .glyph-right::before { transform: rotate(-45deg); } .glyph-left::before { transform: rotate(135deg); }
  .glyph-down::before { transform: translateY(-2px) rotate(45deg); } .glyph-up::before { transform: translateY(2px) rotate(-135deg); }
  .glyph-search::before { width: 9px; height: 9px; border: 2px solid currentcolor; border-radius: 50%; }
  .glyph-close::before { content: "×"; width: auto; height: auto; border: 0; font-size: 20px; line-height: 1; }
  .glyph-menu::before { width: 16px; height: 2px; border: 0; background: currentcolor; box-shadow: 0 -5px 0 currentcolor, 0 5px 0 currentcolor; }
  .site-header .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; }
  .site-header .icon-btn .glyph { width: 20px; height: 20px; }
  .site-header .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .site-header .brand .logo { height: ${v('--header-logo-height', '56px')}; width: auto; }
  .site-header .brand-text { display: flex; flex-direction: column; white-space: nowrap; }
  .site-header .nav-actions { flex-wrap: nowrap; }
  .site-header .icon-btn .glyph-search::before { width: 13px; height: 13px; }
  .site-header .brand-text .nav-text:first-child { font-family: ${v('--type-display-font-family', 'inherit')}; color: ${v('--palette-heading-fg', 'inherit')}; font-size: 1.25em; line-height: 1.2; }
  .site-header .brand-text .nav-text + .nav-text { font-size: 0.875em; font-style: italic; line-height: 1.3; }
  .site-header nav .glyph { display: none; }
  .site-header .utility-bar { border-bottom: 1px solid ${v('--palette-light-band-bg', '#eee')}; font-size: 12px; line-height: 1; }
  .site-header .utility-bar .container { display: flex; justify-content: flex-end; gap: 16px; padding-top: 10px; padding-bottom: 10px; }
  .site-header .utility-bar a { text-decoration: underline; }
  @media (min-width: 901px) {
    .site-header .chrome-row .container { min-height: ${v('--header-row-height', '80px')}; }
    .site-header nav { gap: 24px; font-family: ${v('--type-nav-font-family', 'inherit')}; font-size: ${v('--type-nav-font-size', 'inherit')}; }
  }
  .site-header .nav-toggle { display: none; }
  .site-header .glyph-search::before { box-shadow: none; }
  .site-header .glyph-search { position: relative; }
  .site-header .glyph-search::after { content: ""; position: absolute; width: 2px; height: 6px; background: currentcolor; transform: translate(7px, 7px) rotate(-45deg); }
  @media (max-width: 900px) {
    .site-header nav, .site-header .utility-bar { display: none; }
    .site-header .nav-toggle { display: inline-flex; }
    .site-header.nav-open .chrome-row .container { flex-wrap: wrap; }
    .site-header.nav-open nav { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; flex-basis: 100%; order: 3; margin: 0; padding: 8px 0 16px; }
    .site-header .chrome-row .container { flex-wrap: nowrap; min-height: 64px; }
    .site-header .brand .logo { height: ${v('--header-logo-height-mobile', '40px')}; }
    .site-header .brand-text { font-size: 14px; }
  }
  .site-main .disclosure { border-bottom: 1px solid ${v('--palette-light-band-bg', '#ddd')}; }
  .site-main .disclosure:first-of-type, .site-main :not(.disclosure) + .disclosure { border-top: 1px solid ${v('--palette-light-band-bg', '#ddd')}; }
  .site-main .disclosure-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 0; border: 0; background: none; color: ${v('--palette-heading-fg', 'inherit')}; font-family: ${v('--type-display-font-family', 'inherit')}; font-size: ${v('--type-h3-font-size', '1.25em')}; line-height: ${v('--type-h3-line-height', '1.3')}; font-weight: ${v('--type-h3-font-weight', '600')}; text-align: left; cursor: pointer; }
  .site-main .disclosure-toggle .glyph { color: ${v('--palette-accent', 'currentColor')}; width: 24px; height: 24px; }
  .site-main .disclosure-toggle[aria-expanded="true"] .glyph::before { transform: translateY(2px) rotate(-135deg); }
  .site-main .disclosure-panel { padding: 0 0 24px; }
  .site-main .table-wrap { overflow-x: auto; margin: 0 0 24px; }
  .site-main .table { width: 100%; border-collapse: collapse; }
  .site-main .table :is(th, td) { padding: 16px; border-bottom: 1px solid ${v('--palette-light-band-bg', '#ddd')}; text-align: left; vertical-align: top; }
  .site-main .table th { background: ${v('--palette-light-band-bg', '#f3f3f3')}; color: ${v('--palette-heading-fg', 'inherit')}; }
  .site-main .table :is(th, td) p { margin: 0; }
  .site-main .media-wide img { width: 100%; max-height: none; }
  .site-main .inline-media { display: block; width: 100%; height: auto; margin: 0 0 16px; }
  .site-main .list { padding-left: 1.2em; }
  .site-main .media img { max-height: 360px; width: auto; }
  .site-main .icon { display: inline-block; height: 1.6em; width: auto; vertical-align: middle; margin-right: 0.5em; }
  .site-main .logos { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px 40px; margin: 0 0 16px; }
  .site-main .logos img { height: 48px; width: auto; }
  .site-main .layout-split .panel { display: grid; grid-template-columns: var(--split-columns, 1fr 1fr); gap: ${v('--layout-column-gap', '40px')}; align-items: center; }
  .site-main .split-img { max-width: 100%; max-height: 520px; justify-self: end; }
  .site-main .media-first .split-img { order: -1; justify-self: start; }
  .site-main .align-center .flow { text-align: center; justify-items: center; }
  .site-main .align-center .flow > :is(.actions, .logos) { justify-content: center; }
  .site-main .align-center .card { text-align: start; }
  .site-main .band.align-center .flow > .heading:first-child { justify-self: center; }
  .site-main .align-center .flow > .heading { text-align: center; }
  .site-main .align-center.width-narrow .panel { margin-inline: auto; }
  .site-main .cards { display: grid; grid-template-columns: repeat(var(--cards-columns, 3), minmax(0, 1fr)); gap: ${v('--layout-column-gap', '40px')}; margin: 16px 0; }
  .site-main .card { background: ${r('--card-bg', v('--palette-light-band-bg', 'transparent'))}; border-radius: ${r('--card-radius', v('--radii-card', '0'))}; box-shadow: ${v('--shadows-card', 'none')}; padding: ${r('--card-padding', '40px')}; }${rootNames.has('--card-title-color') ? '\n  .site-main .card :is(h2, h3, h4, .heading) { color: var(--card-title-color); }' : ''}
  .site-main .card > p.aux:first-child:has(> .link:only-child) .link { font-family: ${v('--type-heading-family', 'inherit')}; font-size: ${v('--type-h4-font-size', '1.5em')}; line-height: 1.25; color: ${v('--palette-accent', 'inherit')}; text-decoration: none; }
  .site-main .card > .glyph:last-child { display: flex; width: 28px; height: 28px; margin-top: 12px; color: ${v('--palette-accent', 'currentColor')}; position: relative; }
  .site-main .card > .glyph-right:last-child::before { position: absolute; right: 6px; width: 9px; height: 9px; transform: rotate(-45deg); }
  .site-main .card > .glyph-right:last-child::after { content: ""; position: absolute; left: 4px; right: 5px; top: 13px; height: 2px; background: currentcolor; }
  .site-main .card > :last-child { margin-bottom: 0; }
  .site-main .card:has(> .media:first-child) { padding: 0 0 32px; overflow: hidden; }
  .site-main .card:has(> .media:first-child) > :not(.media:first-child) { margin-inline: 24px; }
  .site-main .card > .media:first-child { margin: 0 0 24px; }
  .site-main .card > .media:first-child img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; max-height: none; }
  .site-main :is(.cards-dark, .cards-accent, .cards-light) .card { border-color: transparent; }
  .site-main .cards-dark .card { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .cards-accent .card { background: ${v('--palette-accent', 'transparent')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .cards-light .card { background: ${v('--palette-light-band-bg', '#f3f3f3')}; }
  .site-main :is(.cards-dark, .cards-accent) .card :is(h1, h2, h3, h4, .heading, .link) { color: inherit; }
  .site-main .tone-dark .panel, .site-main .tone-light .panel, .site-main .tone-accent .panel { border-radius: ${v('--radii-card', '0')}; padding: 50px 60px; }
  .site-main .bleed.tone-dark, .site-main .bleed.tone-light, .site-main .bleed.tone-accent { padding-top: ${v('--layout-section-padding-y', '64px')}; padding-bottom: ${v('--layout-section-padding-y', '64px')}; }
  .site-main .bleed.tone-dark { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .bleed.tone-light { background: ${v('--palette-light-band-bg', '#f3f3f3')}; }
  .site-main .bleed.tone-accent { background: ${v('--palette-accent', 'transparent')}; }
  .site-main .bleed .panel { background: none !important; border-radius: 0; padding: 0; }
  .site-main .tone-dark .panel { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .tone-dark :is(h1, h2, h3, h4) { color: inherit; }
  .site-main .tone-dark .card { background: transparent; box-shadow: none; border-color: transparent; }
  .site-main .tone-light .panel { background: ${v('--palette-light-band-bg', '#f3f3f3')}; }
  .site-main .tone-light .card { background: ${v('--palette-page-bg', '#fff')}; }
  .site-main .tone-accent .panel { background: ${v('--palette-accent', 'transparent')}; }
  .site-main .tone-accent .link { color: inherit; }
  .site-footer { padding: 48px 0; }
  .site-footer .chrome-footer { display: grid; grid-template-columns: 1fr 2fr; gap: 40px; }
  .site-footer ul { list-style: none; margin: 0; padding: 0; columns: 2; }
  .site-footer li { margin-bottom: 16px; }
  .site-footer a { text-decoration: none; }
  .site-footer.tone-dark { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; border-radius: ${v('--radii-card', '0')} ${v('--radii-card', '0')} 0 0; }
  .site-footer.tone-light { background: ${v('--palette-light-band-bg', '#f3f3f3')}; }
  .site-footer.tone-accent { background: ${v('--palette-accent', 'transparent')}; }
  .site-footer .footer-zoned { display: block; font-size: 0.889em; }
  .site-footer .footer-main { display: flex; gap: 40px; }
  .site-footer .footer-main > * { flex: 1 1 0; min-width: 0; }
  .site-footer .footer-zoned a { color: inherit; }
  .site-footer .footer-zoned ul { columns: 1; }
  .site-footer .footer-zoned p { margin: 0 0 16px; }
  .site-footer .footer-brand > p { max-width: 300px; }
  .site-footer .footer-brand .logo { display: block; height: ${v('--header-logo-height', '40px')}; width: auto; margin-bottom: 24px; }
  .site-footer .footer-name { font-family: ${v('--type-heading-family', 'inherit')}; color: ${v('--palette-heading-fg', 'inherit')}; font-size: 1.25em; }
  .site-footer .footer-col-title { font-weight: 700; }
  .site-footer .footer-social { margin-top: 40px; display: flex; align-items: center; gap: 16px; font-size: 0.875em; }
  .site-footer .footer-social p { margin: 0; }
  .site-footer .footer-social ul { display: flex; gap: 16px; }
  .site-footer .footer-social li { margin: 0; }
  @media (max-width: 900px) {
    .site-main .layout-grid-2 .flow { grid-template-columns: 1fr; }
    .site-main .layout-split .panel { grid-template-columns: minmax(0, 1fr); }
    .site-main .layout-split .panel > * { min-width: 0; }
    .site-main .split-img { justify-self: stretch; width: 100%; }
    .site-main .cards { grid-template-columns: minmax(0, 1fr); }
    .site-footer .chrome-footer { grid-template-columns: 1fr; }
    .site-footer .footer-main { flex-direction: column; gap: 24px; }
    .site-footer .footer-zoned { text-align: center; line-height: 1.4; }
    .site-footer .footer-brand > p { max-width: none; }
    .site-footer .footer-brand .logo { margin: 0 auto 24px; }
    .site-footer .footer-social { justify-content: center; margin-top: 24px; white-space: nowrap; }
    .site-footer .footer-zoned li { margin-bottom: 12px; }
  }
  @media (max-width: 640px) {
    .site-main section { padding-top: ${r('--section-padding-mobile', '24px')}; padding-bottom: ${r('--section-padding-mobile', '24px')}; }
    .site-main .layout-media-band .panel { padding: 24px; }
    .site-main .inset > .container { padding: 0 ${r('--gutter-mobile', '20px')}; }${rootNames.has('--gutter-mobile') ? '\n    .container { padding-left: var(--gutter-mobile); padding-right: var(--gutter-mobile); }' : ''}
    .site-main .tone-dark .panel, .site-main .tone-light .panel, .site-main .tone-accent .panel { padding: 32px ${r('--gutter-mobile', '20px')}; }
    .site-footer ul { columns: 1; }
    .site-main .table :is(th, td) { padding: 8px; }
    .site-main :is(.heading, .heading-display .heading) { font-size: min(${v('--type-display-font-size', '2em')}, 11vw); }
    .site-main .heading { overflow-wrap: break-word; }
  }`;

  const headerHtml = chromeHtml(mapping.chrome?.header || [], 'header');
  const html = `<!doctype html>
<html lang="${esc(md.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(md.title)}</title>
${metaTags}
<style>
${css}
</style>
<!-- stardust:prototype
  writtenBy:        stardust:reskin/stream-render
  writtenAt:        ${now}
  page:             ${slug}
  pageUrl:          ${md.canonical || ''}
  template:         ${pageMap.template || slug}
  readArtifacts:
    - reskin/content-model/${slug}/content-model.json
    - reskin/donor-tokens.json
    - reskin/mapping.json${mapping.chrome?.model ? `\n    - ${mapping.chrome.model}/content-model.json` : ''}
  unsourcedContent: []
-->
</head>
<body>
<header class="site-header" data-canon="header">
  ${headerHtml}
</header>
<main class="site-main" data-template="${esc(pageMap.template || slug)}">
  ${sections.join('\n  ')}
</main>
<footer class="site-footer${['dark', 'light', 'accent'].includes(mapping.chrome?.footerTone) ? ` tone-${mapping.chrome.footerTone}` : ''}" data-canon="footer">
  ${chromeHtml(mapping.chrome?.footer || [], 'footer')}
</footer>${headerHtml.includes('class="icon-btn nav-toggle"') ? `
<script>document.addEventListener('click', (e) => { const b = e.target.closest('.nav-toggle'); if (!b) return; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); b.closest('.site-header').classList.toggle('nav-open', open); });</script>` : ''}${sections.some((h) => h.includes('class="disclosure"')) ? `
<script>document.addEventListener('click', (e) => { const b = e.target.closest('.disclosure-toggle'); if (!b) return; const p = document.getElementById(b.getAttribute('aria-controls')); const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); if (open) p.removeAttribute('hidden'); else p.setAttribute('hidden', 'until-found'); });</script>` : ''}
</body>
</html>
`;
  return { html, images, slots: model.sections.length, vars: vars.length, warnings };
}

// ---- mapping.json schema (reference/mapping-json.md) ----------------------------------------------------
// Every key render() reads, with its allowed values. Keys starting with `_` or `$` are annotations
// ($schema, _note, _provenance) and are never read. Pure; exported for tests.
export const MAPPING_SCHEMA = {
  top: ['chrome', 'pages', 'blocks'],
  chrome: ['model', 'header', 'footer', 'footerTone', 'navAlign'],
  page: ['template', 'slots'],
  slot: ['module', 'layout', 'width', 'tone', 'columns', 'heading', 'inset', 'split'],
  layout: ['stack', 'grid-2', 'media-band', 'split', 'cards'],
  width: ['narrow', 'wide'],
  tone: ['dark', 'light', 'accent'],
  heading: ['display', 'h2', 'h3', 'h4'],
  navAlign: ['start', 'center', 'end'],
};
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const annotation = (k) => k.startsWith('_') || k.startsWith('$');

// Validates a parsed mapping.json. models: { <slug>: content model | null } (null/absent: slot ids not
// checked); chromeModel: the chrome content model or null; slugs: pages that must be present.
// Returns ["<path>: <problem>", …]; empty when valid.
export function checkMapping(mapping, { models = {}, chromeModel = null, slugs = [] } = {}) {
  const S = MAPPING_SCHEMA; const out = [];
  const one = (v, allowed) => allowed.includes(v);
  const unknown = (o, allowed, at) => { for (const k of Object.keys(o)) if (!annotation(k) && !allowed.includes(k)) out.push(`${at}${k}: unknown key (allowed: ${allowed.join(', ')})`); };
  if (!isObj(mapping)) return ['(root): mapping.json must be a JSON object'];
  unknown(mapping, S.top, '');
  const ch = mapping.chrome;
  if (ch !== undefined) {
    if (!isObj(ch)) out.push('chrome: must be an object');
    else {
      unknown(ch, S.chrome, 'chrome.');
      if (ch.model !== undefined && (typeof ch.model !== 'string' || !ch.model)) out.push('chrome.model: must be a directory path holding a content-model.json');
      for (const zone of ['header', 'footer']) {
        const ids = ch[zone];
        if (ids === undefined) continue;
        if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) { out.push(`chrome.${zone}: must be an array of chrome-model slot ids`); continue; }
        if (ids.length && !ch.model) out.push(`chrome.${zone}: set but chrome.model is missing — the ${zone} renders empty`);
        if (chromeModel) for (const id of ids) if (!(chromeModel.sections || []).some((s) => s.slot === id)) out.push(`chrome.${zone}: no slot ${id} in the chrome model ${ch.model}`);
      }
      if (ch.footerTone !== undefined && !one(ch.footerTone, S.tone)) out.push(`chrome.footerTone: "${ch.footerTone}" is not ${S.tone.join(' | ')}`);
      if (ch.navAlign !== undefined && !one(ch.navAlign, S.navAlign)) out.push(`chrome.navAlign: "${ch.navAlign}" is not ${S.navAlign.join(' | ')}`);
    }
  }
  if (mapping.blocks !== undefined) {
    if (!isObj(mapping.blocks)) out.push('blocks: must be an object { "<module id>": "<eds block name>" }');
    else for (const [id, b] of Object.entries(mapping.blocks)) if (!annotation(id) && !(typeof b === 'string' && BLOCK_NAME.test(b))) out.push(`blocks.${id}: ${JSON.stringify(b)} is not an EDS block name (lower-case letters, digits, hyphens)`);
  }
  const pages = mapping.pages;
  if (!isObj(pages)) { out.push('pages: must be an object { "<slug>": { template, slots } }'); return out; }
  for (const slug of slugs) if (!isObj(pages[slug])) out.push(`pages.${slug}: missing — the page was requested but mapping.json has no entry`);
  for (const [slug, pm] of Object.entries(pages)) {
    if (annotation(slug)) continue;
    const at = `pages.${slug}`;
    if (!isObj(pm)) { out.push(`${at}: must be an object { template, slots }`); continue; }
    unknown(pm, S.page, `${at}.`);
    if (pm.template !== undefined && (typeof pm.template !== 'string' || !pm.template)) out.push(`${at}.template: must be the archetype slug (a string)`);
    if (pm.slots === undefined) continue;
    if (!isObj(pm.slots)) { out.push(`${at}.slots: must be an object { "<slot id>": { module, layout, … } }`); continue; }
    const model = models[slug];
    const have = model ? new Set((model.sections || []).map((s) => s.slot)) : null;
    for (const [id, m] of Object.entries(pm.slots)) {
      if (annotation(id)) continue;
      const sat = `${at}.slots.${id}`;
      if (have && !have.has(id)) out.push(`${sat}: no slot ${id} in the content model (slots: ${[...have].join(', ') || 'none'})`);
      if (!isObj(m)) { out.push(`${sat}: must be an object`); continue; }
      unknown(m, S.slot, `${sat}.`);
      if (m.module !== undefined && (typeof m.module !== 'string' || !m.module.trim())) out.push(`${sat}.module: must be a donor module id (e.g. "M2")`);
      if (m.layout !== undefined) {
        const parts = typeof m.layout === 'string' ? m.layout.trim().split(/\s+/) : [];
        const bad = parts.filter((l) => !S.layout.includes(l));
        if (!parts.length || parts[0] === '' || bad.length) out.push(`${sat}.layout: "${m.layout}" is not space-separated ${S.layout.join(' | ')}`);
      }
      for (const k of ['width', 'tone', 'heading']) if (m[k] !== undefined && !one(m[k], S[k])) out.push(`${sat}.${k}: "${m[k]}" is not ${S[k].join(' | ')}`);
      if (m.columns !== undefined && !(Number.isInteger(m.columns) && m.columns > 0)) out.push(`${sat}.columns: ${JSON.stringify(m.columns)} is not a positive integer`);
      if (m.inset !== undefined && !(typeof m.inset === 'string' && /^\d+(\.\d+)?(px|rem|%)$/.test(m.inset))) out.push(`${sat}.inset: ${JSON.stringify(m.inset)} is not a length (px | rem | %)`);
      if (m.split !== undefined && !(typeof m.split === 'string' && /^(\d+(\.\d+)?(px|fr|%) ?){2}$/.test(m.split.trim()))) out.push(`${sat}.split: ${JSON.stringify(m.split)} is not two column tracks (px | fr | %)`);
    }
  }
  return out;
}

// ---- --deploy-map: block-roundtrip's --map arguments (reference/deployed-leg.md § Recipe) ----------------
const BLOCK_NAME = /^[a-z][a-z0-9-]*$/;
// The EDS block a module becomes: mapping.json blocks.<module id>, else the module id lower-cased (M4 → m4).
export const blockName = (mapping, module) => (isObj(mapping?.blocks) && typeof mapping.blocks[module] === 'string' ? mapping.blocks[module] : String(module).toLowerCase());
// One block per mapped module of a page, its instances (section[data-slot]) in page order — the content
// model's slot order when given, else the mapping's. Slots with no module (new-module, carried-invisible)
// are listed apart: they are not a donor block. Pure; exported.
export function deployMap(mapping, slug, model = null) {
  const pm = mapping?.pages?.[slug];
  if (!isObj(pm)) throw new SetupError(`mapping.json has no pages.${slug}`);
  const slots = isObj(pm.slots) ? pm.slots : {};
  const order = model ? (model.sections || []).map((x) => x.slot) : Object.keys(slots).filter((k) => !annotation(k));
  const byBlock = new Map(); const unmapped = [];
  for (const id of order) {
    const m = slots[id];
    if (!m?.module) { unmapped.push(id); continue; }
    const b = blockName(mapping, m.module);
    if (!byBlock.has(b)) byBlock.set(b, { block: b, modules: [], slots: [] });
    const e = byBlock.get(b); e.slots.push(id); if (!e.modules.includes(m.module)) e.modules.push(m.module);
  }
  const blocks = [...byBlock.values()].map((e) => ({ ...e, selector: e.slots.map((id) => `section[data-slot="${id}"]`).join(',') }));
  return { blocks, unmapped, args: blocks.map((e) => `--map '${e.block}=${e.selector}'`).join(' ') };
}

// ---- capture smells (used by capture-content) -----------------------------------------------------------
// The scope warnings capture-content prints, minus the known false positives: an all-whole ("!") scope
// (chrome, a single-form page) is one slot per element by design and may not hold the h1; a slot that
// carries most of the text but is a repeating run (findRepeat covers ≥60% of its stream) is a card grid,
// not a page-wide wrapper. Returns { warnings[], notes[] }. Pure; exported.
export function captureSmells(model) {
  const warnings = []; const notes = [];
  const sections = model?.sections || [];
  const scope = Array.isArray(model?.scope) ? model.scope : [];
  const wholeOnly = scope.length > 0 && scope.every((d) => d.whole);
  if (model?.coverage?.h1InScope === false) {
    if (wholeOnly) notes.push('the page h1 is outside the scope — expected for a whole-element ("!") capture such as chrome');
    else warnings.push('the page h1 is OUTSIDE the declared scope — the top failure mode (hero living in <header>). Widen --scope.');
  }
  const total = (model?.visibleTextNormalized || '').length;
  const largest = sections.reduce((m, s) => ((s.visibleText || '').length > (m?.visibleText || '').length ? s : m), null);
  const share = total && largest ? largest.visibleText.length / total : 0;
  const smell = 'wrapper-scope smell — fewer slots than visible sections, or one mega-slot. Scope DEEPER so the real sections become the scope\'s children (content-model.md § Scope discovery step 3b).';
  if (wholeOnly) {
    if (sections.length < 3 || share > 0.5) notes.push(`granularity not checked: every scope part is whole ("!"), one slot per element by design`);
  } else if (sections.length < 3) warnings.push(smell);
  else if (share > 0.5) {
    const ord = largest.ordered || []; const rep = findRepeat(ord);
    const cover = rep && ord.length ? (rep.bounds[rep.count] - rep.start) / ord.length : 0;
    if (cover >= 0.6) notes.push(`${largest.slot} carries ${Math.round(share * 100)}% of the scope text but is a repeating run (${rep.count} items) — a card grid, not a wrapper`);
    else warnings.push(smell);
  }
  return { warnings, notes };
}

// ---- image localization (CLI) -------------------------------------------------------------------------
// <host>/<path> under img/, unsafe characters folded; an extensionless URL takes an extension from its
// content type. A query becomes a short hash on the file name — image proxies (/_image?href=…,
// /_next/image?url=…) serve every image from one path, so dropping it would collapse them. Pure; exported.
export function localSubpath(u, contentType = '') {
  const x = new URL(u);
  const clean = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  const parts = decodeURIComponent(x.pathname).split('/').filter(Boolean).map(clean);
  let file = parts.pop() || 'index';
  const q = x.search.length > 1 ? `-${createHash('sha1').update(x.search).digest('hex').slice(0, 8)}` : '';
  const m = file.match(/^(.*?)(\.[a-z0-9]{2,5})$/i);
  if (m) file = `${m[1]}${q}${m[2]}`;
  else {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[contentType.split(';')[0].trim()];
    file = `${file}${q}${ext ? `.${ext}` : ''}`;
  }
  return posix.join('img', clean(x.hostname), ...parts, file);
}

// Bot-managed CDNs 403 a bare fetch: send the shared live-session real-Chrome UA + headers and the page as
// Referer. live-session.mjs is the diff skill's (plugin tree or project-copy layout), loaded only here.
async function browserHeaders(referer) {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolve(here, p)).find((p) => existsSync(p));
  const h = { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) };
  if (!file) return h;
  const { REAL_CHROME_UA, standardHeaders } = await import(pathToFileURL(file).href);
  const { Accept, 'Upgrade-Insecure-Requests': _u, ...rest } = standardHeaders();
  return { 'User-Agent': REAL_CHROME_UA, ...rest, ...h };
}

async function localize(urls, assetsDir, referer) {
  const map = new Map(); const failed = [];
  const headers = await browserHeaders(referer);
  for (const u of urls) {
    if (!/^https?:/i.test(u)) continue;
    try {
      const res = await fetch(u, { redirect: 'follow', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = join(assetsDir, ...localSubpath(u, res.headers.get('content-type') || '').split('/'));
      const clash = [...map].find(([k, f]) => f === file && k !== u);
      if (clash) throw new Error(`local path collides with ${clash[0]}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      map.set(u, file);
    } catch (e) { failed.push({ url: u, why: e.message }); }
  }
  return { map, failed };
}

// argv → { pos[], flags }; a value flag needs a value, an unknown flag is a usage error.
const VALUE_FLAGS = ['--dir', '--mapping', '--out', '--model-dir'];
const BOOL_FLAGS = ['--localize-images', '--check', '--register', '--deploy-map', '--help', '-h'];
function parseArgs(argv) {
  const o = { pos: [], dir: 'stardust' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new SetupError(`${a} needs a value`);
      o[a.slice(2)] = v;
    } else if (BOOL_FLAGS.includes(a)) o[a.replace(/^-+/, '')] = true;
    else if (a.startsWith('-')) throw new SetupError(`unknown option ${a}`);
    else o.pos.push(a);
  }
  return o;
}

function readJsonFile(p, what) {
  if (!existsSync(p)) throw new SetupError(`missing ${what}: ${p}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new SetupError(`${what} is not valid JSON: ${p} (${e.message})`); }
}
const optionalJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; } };

// --check: validate mapping.json against the schema and the content models on disk. No render, no writes.
function checkCli(o, mappingFile, modelDir) {
  let mapping;
  try { mapping = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch (e) {
    if (!existsSync(mappingFile)) throw new SetupError(`missing mapping.json: ${mappingFile}`);
    console.log(`${mappingFile}: not valid JSON (${e.message})`); return 1;
  }
  const slugs = o.pos;
  const pageSlugs = isObj(mapping?.pages) ? Object.keys(mapping.pages).filter((k) => !annotation(k)) : [];
  const models = {}; const unmodelled = [];
  for (const slug of new Set([...slugs, ...pageSlugs])) {
    models[slug] = optionalJson(join(modelDir, slug, 'content-model.json'));
    if (!models[slug] && pageSlugs.includes(slug)) unmodelled.push(slug);
  }
  const chromeDir = isObj(mapping?.chrome) && typeof mapping.chrome.model === 'string' ? mapping.chrome.model : null;
  const chromeModel = chromeDir ? optionalJson(join(chromeDir, 'content-model.json')) : null;
  const problems = checkMapping(mapping, { models, chromeModel, slugs });
  if (chromeDir && !chromeModel) problems.push(`chrome.model: no content-model.json under ${chromeDir}`);
  if (unmodelled.length) console.error(`note: no content model under ${modelDir} for ${unmodelled.join(', ')} — their slot ids are not checked`);
  for (const p of problems) console.log(p);
  const slots = pageSlugs.reduce((n, s) => n + (isObj(mapping.pages[s]?.slots) ? Object.keys(mapping.pages[s].slots).length : 0), 0);
  console.error(problems.length ? `${mappingFile}: ${problems.length} problem(s)` : `${mappingFile}: ok — ${pageSlugs.length} page(s), ${slots} slot(s)`);
  return problems.length ? 1 : 0;
}

// ---- --register: the rendered page into state.json (flow reskin only) ----------------------------------
const LIFECYCLE = ['extracted', 'directed', 'prototyped', 'approved', 'migrated'];
// Which lifecycle move a rendered page gets; applies it to `state` through state.mjs's advance().
// A page of a type that already has an approved/migrated archetype is a sibling: it goes no further than
// `directed`, the status migrate renders at the sibling tier (Path A′; `prototyped` is skipped by
// `migrate render --all`). Any other page behind `prototyped` advances to it (its history entry, stale
// cleared). A page at `prototyped` or later only gets its path (a re-render is gated and recorded again;
// preflight compares the recorded prototype sha). Returns { slug, from, to, role, changed } or null.
export function registerRendered(state, slug, prototypePath, { advance, at }) {
  const page = (state.pages || []).find((p) => p.slug === slug);
  if (!page) return null;
  const from = page.status; const i = LIFECYCLE.indexOf(from);
  const sibling = !!page.type && state.pages.some((p) => p.slug !== slug && p.type === page.type && ['approved', 'migrated'].includes(p.status));
  const role = sibling ? 'sibling' : 'page';
  const to = i < 0 || i >= 2 ? from : sibling ? 'directed' : 'prototyped';
  if (to !== from) { advance(state, [slug], { to, prototype: prototypePath, at }); return { slug, from, to, role, changed: true }; }
  const changed = page.prototypePath !== prototypePath;
  page.prototypePath = prototypePath;
  return { slug, from, to, role, changed };
}

async function stateLib() {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [['..', '..', 'stardust', 'scripts', 'state.mjs'], ['..', 'stardust', 'state.mjs']].map((p) => join(here, ...p)).find((p) => existsSync(p));
  if (!file) throw new SetupError('--register needs state.mjs (skills/stardust/scripts/state.mjs, or its project copy stardust/scripts/stardust/state.mjs)');
  return import(pathToFileURL(file).href);
}

// Loads <dir>/state.json for --register and refuses outside flow reskin, before anything is rendered.
async function registerSetup(dir) {
  const lib = await stateLib();
  let r; try { r = lib.readState(dir); } catch (e) { throw new SetupError(`--register: ${e.message}`); }
  if (r.state.flow !== 'reskin') throw new SetupError(`--register: ${r.file} flow is ${r.state.flow ? `"${r.state.flow}"` : 'unset'} — only a flow "reskin" project registers reskin pages (render without --register)`);
  return { lib, ...r };
}

function registerCli({ lib, state, file }, slug, out, dir) {
  const root = dirname(resolve(dir));
  const prototypePath = relative(root, out).split(sep).join('/');
  const at = lib.nowIso();
  const r = registerRendered(state, slug, prototypePath, { advance: lib.advance, at });
  if (!r) { console.log(`note: ${slug} is not a page in ${file} — not registered`); return; }
  if (r.changed) { state._provenance = lib.stampProvenance(state._provenance, 'stardust:reskin', at); lib.writeState(file, state); }
  const move = r.to === r.from ? `stays ${r.from}` : `${r.from} → ${r.to}`;
  console.log(`registered ${slug}: prototypePath ${prototypePath}, ${move}${r.role === 'sibling' ? ' (sibling of an approved archetype: migrate renders it at the sibling tier)' : ''}${r.changed ? '' : ' (unchanged)'}`);
  if (['approved', 'migrated'].includes(r.from)) console.log(`note: ${slug} is ${r.from}; re-run its gates and reskin-ledger.mjs record ${slug} (preflight fails a prototype changed since it was recorded)`);
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || o.h) { console.log(HELP); return 0; }
  const { dir } = o;
  const mappingFile = o.mapping || join(dir, 'reskin', 'mapping.json');
  const modelDir = o['model-dir'] || join(dir, 'reskin', 'content-model');
  if (o.check) return checkCli(o, mappingFile, modelDir);
  const slug = o.pos[0];
  if (!slug) { console.error(HELP); return 2; }
  if (o.pos.length > 1) throw new SetupError(`one <slug> per ${o['deploy-map'] ? '--deploy-map' : 'render'} (got ${o.pos.join(', ')})`);
  if (o['deploy-map']) {
    const dm = deployMap(readJsonFile(mappingFile, 'mapping.json'), slug, optionalJson(join(modelDir, slug, 'content-model.json')));
    console.log(dm.args);
    for (const b of dm.blocks) console.error(`${b.block} (${b.modules.join(', ')}): ${b.slots.join(', ')}`);
    if (dm.unmapped.length) console.error(`no module, not a donor block: ${dm.unmapped.join(', ')} — default content, or give the slot a module in mapping.json`);
    return 0;
  }
  const reg = o.register ? await registerSetup(dir) : null;
  const readJson = readJsonFile;
  const mapping = readJson(mappingFile, 'mapping.json');
  const model = readJson(join(modelDir, slug, 'content-model.json'), `content model for ${slug}`);
  const tokens = readJson(join(dir, 'reskin', 'donor-tokens.json'), 'donor-tokens.json');
  const chromeModel = mapping.chrome?.model ? readJson(join(mapping.chrome.model, 'content-model.json'), 'chrome content model') : null;
  const out = resolve(o.out || join(dir, 'reskin', 'pages', `${slug}.html`));
  const input = { slug, model, tokens, mapping, chromeModel };

  let result = render(input);
  // Figma-sourced models reference their own cached bytes (assets/<node>.<ext> beside the model): copy them
  // under prototypes/assets/img/figma/<slug>/ (the migrate/deploy bundler root) and keep data-source-src.
  const relSrc = (u) => u && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u) && !u.startsWith('/');
  if (model._provenance?.source?.kind === 'figma' || result.images.some(relSrc)) {
    const roots = [join(dir, 'reskin', 'content-model', slug), mapping.chrome?.model].filter(Boolean);
    const target = resolve(dir, 'prototypes', 'assets', 'img', 'figma', slug);
    const copied = new Map(); const missing = [];
    for (const u of result.images.filter(relSrc)) {
      const from = u.split(/[\\/]/).includes('..') ? null : roots.map((r) => join(r, u)).find((f) => existsSync(f) && resolve(f).startsWith(resolve(dirname(f), '..') + sep));
      if (!from) { missing.push(u); continue; }
      const to = join(target, ...u.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      // The page's own assets/ mirror, as --localize-images keeps: src="assets/img/…" resolves from the page and,
      // through migrate's `assets/` prefix, against its default --proto-dir (<dir>/prototypes).
      const mirror = join(dirname(out), 'assets', relative(resolve(dir, 'prototypes', 'assets'), to));
      if (resolve(mirror) !== resolve(to)) { mkdirSync(dirname(mirror), { recursive: true }); copyFileSync(to, mirror); }
      copied.set(u, mirror);
    }
    const rel = (file) => relative(dirname(out), file).split(sep).join('/');
    result = render({ ...input, resolveImg: (u) => (copied.has(u) ? { src: rel(copied.get(u)), source: u } : { src: u }) });
    console.log(`figma assets: ${copied.size} copied → ${relative(process.cwd(), target)}/`);
    for (const u of missing) console.error(`WARN figma asset missing: ${u} (supply it under the model's assets/ and re-run figma-donor.mjs content)`);
  }
  if (o['localize-images']) {
    const assetsDir = resolve(dir, 'prototypes', 'assets');
    const loc = await localize(result.images, assetsDir, model.metadata?.canonical || model.url || undefined);
    // The page's own assets/ mirror: src="assets/img/…" resolves from the page in a browser and, through
    // migrate's `assets/` prefix, against its default --proto-dir (<dir>/prototypes).
    const pageAssets = join(dirname(out), 'assets');
    const local = new Map([...loc.map].map(([u, file]) => {
      const mirror = join(pageAssets, relative(assetsDir, file));
      if (resolve(mirror) !== resolve(file)) { mkdirSync(dirname(mirror), { recursive: true }); copyFileSync(file, mirror); }
      return [u, mirror];
    }));
    const rel = (file) => relative(dirname(out), file).split(sep).join('/');
    result = render({ ...input, resolveImg: (u) => (local.has(u) ? { src: rel(local.get(u)), source: u } : { src: u }) });
    console.log(`localized ${loc.map.size}/${result.images.length} image(s) → ${relative(process.cwd(), assetsDir)}/img/`);
    for (const f of loc.failed) console.error(`WARN image kept remote: ${f.url} (${f.why})`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.html);
  console.log(`rendered ${slug} → ${relative(process.cwd(), out)} (${result.slots} slot(s), ${result.vars} token vars)`);
  if (reg) registerCli(reg, slug, out, dir);
  for (const w of result.warnings) console.log(`warning: ${w}`);
  if (!existsSync(join(dir, 'reskin', 'mapping.md'))) console.error('note: reskin/mapping.md (the human mapping brief) is missing — Phase 3 requires it');
  return 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(fileURLToPath(import.meta.url)) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`stream-render: ${e.message}`);
    process.exit(e instanceof SetupError ? 2 : 1);
  });
}
