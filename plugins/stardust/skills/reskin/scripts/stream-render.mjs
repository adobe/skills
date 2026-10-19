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
 * becomes a short hash on the file name so image-proxy URLs stay distinct), writes
 * src relative to --out and keeps data-source-src="<original>" — dom-equality and slot-coverage match
 * on it, so the gates hold on a localized page. A failed download (or two URLs landing on one local
 * file) keeps the remote src and is listed.
 *
 * mapping.json (the only per-site input):
 *   { "chrome": { "model": "<dir holding a content-model.json>", "header": ["s01"], "footer": ["s03"], "footerTone": "dark|light|accent",
 *       "navAlign": "start|center|end" },
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
 *   e.g. image+h3+p per team member) as a grid of
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
 *     [--out <dir>/reskin/pages/<slug>.html] [--localize-images]
 *
 * Reads:  <dir>/reskin/content-model/<slug>/content-model.json, <dir>/reskin/donor-tokens.json,
 *         the mapping, the chrome model when mapped.
 * Writes: --out (parent dirs created); with --localize-images also <dir>/prototypes/assets/img/**.
 * Exit:   0 rendered, 1 render error (unknown node kind, label round-trip), 2 setup error.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rootTokens } from './render/root-tokens.mjs';

const HELP = `usage: node stream-render.mjs <slug> [--dir stardust] [--mapping <file>] [--out <file>] [--localize-images]

Render one page from <dir>/reskin/content-model/<slug>/content-model.json with the donor tokens in
<dir>/reskin/donor-tokens.json and the slot mapping in <dir>/reskin/mapping.json.
  --dir <d>            stardust state dir (default stardust)
  --mapping <file>     mapping.json (default <dir>/reskin/mapping.json)
  --out <file>         output HTML (default <dir>/reskin/pages/<slug>.html); to hand off to migrate,
                       write <dir>/prototypes/<slug>-proposed.html
  --localize-images    download images to <dir>/prototypes/assets/img/ and keep data-source-src
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
export function findRepeat(ordered, opts = {}) {
  const exact = repeatRun(ordered, opts, true);
  const loose = repeatRun(ordered, opts, false);
  if (!loose || (exact && exact.covered >= loose.covered)) return exact && { start: exact.start, period: exact.period, count: exact.count };
  return { start: loose.start, period: loose.period, count: loose.count };
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
  function inlineHtml(nodes) {
    return nodes.map((n) => {
      const sep = n.sep ?? '';
      if (n.kind === 'cta') return `${sep}<a class="link" href="${url(n)}">${n.children ? inlineHtml(n.children) : txt(n)}</a>`;
      // An image inside a link or paragraph (arrow, social badge) is content: it stays, inline.
      if (n.kind === 'image') return `${sep}<img class="icon" ${img(n.currentSrc || n.src)} alt="${esc(n.alt)}">`;
      if (n.children) return `${sep}${inlineHtml(n.children)}`;
      return `${sep}${txt(n)}`;
    }).join('');
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
      switch (n.kind) {
        case 'heading': {
          // A sub-heading whose donor type role differs from display is sized by that role, so drifting DOM
          // levels (h3/h4/h5 on visually equal card titles) render alike.
          const r = /^h[2-6]$/.test(n.role || '') && has(`--type-${n.role}-font-size`) ? ` role-${n.role}` : '';
          out.push(`<${n.level || 'h2'} class="heading${r}">${txt(n)}</${n.level || 'h2'}>`); break;
        }
        case 'paragraph': out.push(`<p class="${n.children?.some((c) => c.kind === 'cta') ? 'aux' : 'lead'}">${n.children ? inlineHtml(n.children) : txt(n)}</p>`); break;
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
    if (links.length) return links.map((c) => `<a href="${url(c)}">${esc(c.text)}</a>`);
    const text = (n.text || '').trim();
    if (!text || n.kind === 'image') return [];
    // a Figma-only capture lists its links as ctas and their text as plain stream nodes
    const cta = s.ctas.find((c) => (c.text || '').trim() === text);
    if (cta) return [`<a href="${url(cta)}">${esc(text)}</a>`];
    if (n.kind === 'listItem') return [`<button class="nav-menu" type="button" aria-expanded="false">${esc(text)}</button>`];
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
        : `<button class="${cls()}" type="button">${esc((n.text || '').trim())}</button>`));
    });
    const navAlign = mapping.chrome?.navAlign ?? tokens.layout?.navAlign;
    const align = ['start', 'center', 'end'].includes(navAlign) ? navAlign : 'end';
    return `<div class="chrome-row nav-align-${align}"><div class="container">
      ${logos}
      <nav>${menu.join('')}</nav>${actions.length ? `
      <div class="nav-actions">${actions.join('')}</div>` : ''}
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
      const texts = footerTexts(s);
      return `<div class="container chrome-footer">
      <div>${s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('')}${texts.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      <ul>${s.ctas.map((c) => `<li><a href="${url(c)}">${esc(c.text)}</a></li>`).join('')}</ul>
    </div>`;
    })())).join('\n  ');
  }

  // ---- page -------------------------------------------------------------------------------------------
  const sections = model.sections.map((s, i) => {
    const m = pageMap.slots?.[s.slot] || {};
    const layout = (m.layout || 'stack').split(/\s+/);
    const ctx = { band: layout.includes('media-band'), split: layout.includes('split'), bandImage: null, buttons: 0 };
    let inner;
    const rep = layout.includes('cards') ? findRepeat(s.ordered) : null;
    if (rep) {
      const end = rep.start + rep.period * rep.count;
      const items = Array.from({ length: rep.count }, (_, k) => s.ordered.slice(rep.start + k * rep.period, rep.start + (k + 1) * rep.period));
      const cols = Number.isInteger(m.columns) && m.columns > 0 ? m.columns : (rep.count % 3 === 0 ? 3 : 2);
      inner = [
        streamHtml(s.ordered.slice(0, rep.start), ctx),
        `<div class="cards" style="--cards-columns: ${cols}">${items.map((it) => `<div class="card">${streamHtml(it, { ...ctx, band: false, split: false })}</div>`).join('')}</div>`,
        streamHtml(s.ordered.slice(end), ctx),
      ].filter(Boolean).join('\n        ');
    } else {
      if (layout.includes('cards')) warnings.push(`${s.slot}: layout "cards" but no repeating run in the stream — rendered as a stack`);
      inner = streamHtml(s.ordered, ctx);
    }
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
    const cls = ['band', ...layout.map((l) => `layout-${l}`), `width-${m.width || 'narrow'}`, ...(tone ? [`tone-${tone}`] : []), ...(role ? [`heading-${role}`] : []), ...(inset ? ['inset'] : []), ...(tone && m.bleed === true ? ['bleed'] : []), ...(m.align === 'center' ? ['align-center'] : []), ...(mediaFirst ? ['media-first'] : [])].join(' ');
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
  :is(.site-main, .site-header) .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; background: ${v('--buttons-primary-background', 'currentColor')}; color: ${v('--buttons-primary-color', '#fff')}; border: ${v('--buttons-primary-border', '0')}; border-radius: ${v('--buttons-primary-border-radius', '4px')}; padding: ${v('--buttons-primary-padding', '8px 16px')}; font-family: inherit; font-size: ${v('--buttons-primary-font-size', 'inherit')}; font-weight: ${v('--buttons-primary-font-weight', '700')}; line-height: ${v('--buttons-primary-line-height', v('--type-body-line-height', 'inherit'))}; text-decoration: none; cursor: pointer; }
  :is(.site-main, .site-header) .btn-secondary { background: ${v('--buttons-secondary-background', 'transparent')}; color: ${v('--buttons-secondary-color', 'inherit')}; border: ${v('--buttons-secondary-border', '1px solid currentColor')}; }
  .site-main .width-narrow .btn { width: 100%; }

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
  .site-main .card { background: ${v('--palette-light-band-bg', 'transparent')}; border-radius: ${v('--radii-card', '0')}; box-shadow: ${v('--shadows-card', 'none')}; padding: 40px; }
  .site-main .card > :last-child { margin-bottom: 0; }
  .site-main .tone-dark .panel, .site-main .tone-light .panel, .site-main .tone-accent .panel { border-radius: ${v('--radii-card', '0')}; padding: 50px 60px; }
  .site-main .bleed.tone-dark, .site-main .bleed.tone-light, .site-main .bleed.tone-accent { padding-top: ${v('--layout-section-padding-y', '64px')}; padding-bottom: ${v('--layout-section-padding-y', '64px')}; }
  .site-main .bleed.tone-dark { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .bleed.tone-light { background: ${v('--palette-light-band-bg', '#f3f3f3')}; }
  .site-main .bleed.tone-accent { background: ${v('--palette-accent', 'transparent')}; }
  .site-main .bleed .panel { background: none !important; border-radius: 0; padding: 0; }
  .site-main .tone-dark .panel { background: ${v('--palette-dark-band-bg', '#111')}; color: ${v('--palette-dark-band-fg', '#fff')}; }
  .site-main .tone-dark :is(h1, h2, h3, h4) { color: inherit; }
  .site-main .tone-dark .card { background: transparent; box-shadow: none; }
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
  @media (max-width: 900px) {
    .site-main .layout-grid-2 .flow { grid-template-columns: 1fr; }
    .site-main .layout-split .panel { grid-template-columns: minmax(0, 1fr); }
    .site-main .layout-split .panel > * { min-width: 0; }
    .site-main .split-img { justify-self: center; }
    .site-main .cards { grid-template-columns: minmax(0, 1fr); }
    .site-footer .chrome-footer { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .site-main section { padding-top: 24px; padding-bottom: 24px; }
    .site-main .layout-media-band .panel { padding: 24px; }
    .site-main .inset > .container { padding: 0 20px; }
    .site-main .tone-dark .panel, .site-main .tone-light .panel, .site-main .tone-accent .panel { padding: 32px 20px; }
    .site-footer ul { columns: 1; }
    .site-main :is(.heading, .heading-display .heading) { font-size: min(${v('--type-display-font-size', '2em')}, 11vw); }
    .site-main .heading { overflow-wrap: break-word; }
  }`;

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
  ${chromeHtml(mapping.chrome?.header || [], 'header')}
</header>
<main class="site-main" data-template="${esc(pageMap.template || slug)}">
  ${sections.join('\n  ')}
</main>
<footer class="site-footer${['dark', 'light', 'accent'].includes(mapping.chrome?.footerTone) ? ` tone-${mapping.chrome.footerTone}` : ''}" data-canon="footer">
  ${chromeHtml(mapping.chrome?.footer || [], 'footer')}
</footer>
</body>
</html>
`;
  return { html, images, slots: model.sections.length, vars: vars.length, warnings };
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
    const cover = rep && ord.length ? (rep.period * rep.count) / ord.length : 0;
    if (cover >= 0.6) notes.push(`${largest.slot} carries ${Math.round(share * 100)}% of the scope text but is a repeating run (${rep.count} × ${rep.period} nodes) — a card grid, not a wrapper`);
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

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
  const slug = argv[0];
  if (!slug || slug.startsWith('--')) { console.error(HELP); return 2; }
  const dir = flag('--dir', 'stardust');
  const readJson = (p, what) => {
    if (!existsSync(p)) throw new SetupError(`missing ${what}: ${p}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };
  const mapping = readJson(flag('--mapping', join(dir, 'reskin', 'mapping.json')), 'mapping.json');
  const model = readJson(join(dir, 'reskin', 'content-model', slug, 'content-model.json'), `content model for ${slug}`);
  const tokens = readJson(join(dir, 'reskin', 'donor-tokens.json'), 'donor-tokens.json');
  const chromeModel = mapping.chrome?.model ? readJson(join(mapping.chrome.model, 'content-model.json'), 'chrome content model') : null;
  const out = resolve(flag('--out', join(dir, 'reskin', 'pages', `${slug}.html`)));
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
      copied.set(u, to);
    }
    const rel = (file) => relative(dirname(out), file).split(sep).join('/');
    result = render({ ...input, resolveImg: (u) => (copied.has(u) ? { src: rel(copied.get(u)), source: u } : { src: u }) });
    console.log(`figma assets: ${copied.size} copied → ${relative(process.cwd(), target)}/`);
    for (const u of missing) console.error(`WARN figma asset missing: ${u} (supply it under the model's assets/ and re-run figma-donor.mjs content)`);
  }
  if (argv.includes('--localize-images')) {
    const assetsDir = resolve(dir, 'prototypes', 'assets');
    const loc = await localize(result.images, assetsDir, model.metadata?.canonical || model.url || undefined);
    const rel = (file) => relative(dirname(out), file).split(sep).join('/');
    result = render({ ...input, resolveImg: (u) => (loc.map.has(u) ? { src: rel(loc.map.get(u)), source: u } : { src: u }) });
    console.log(`localized ${loc.map.size}/${result.images.length} image(s) → ${relative(process.cwd(), assetsDir)}/img/`);
    for (const f of loc.failed) console.error(`WARN image kept remote: ${f.url} (${f.why})`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.html);
  console.log(`rendered ${slug} → ${relative(process.cwd(), out)} (${result.slots} slot(s), ${result.vars} token vars)`);
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
