#!/usr/bin/env node
/**
 * skills/deploy/scripts/chrome-docs.mjs — canon chrome → the authored /nav and /footer documents (deploy Step 6).
 *
 * Why this exists: deploy publishes the chrome as two authored documents, content/nav.html and content/footer.html,
 * which the stock header and footer blocks fetch. Agents in recorded hands-off runs hand-wrote their own converter
 * from stardust/canon/header.html + footer.html every time, because nothing shipped did the job.
 *
 * Usage:
 *   node skills/deploy/scripts/chrome-docs.mjs [--canon stardust/canon] [--content content] [--prefix <locale>] [--check]
 *
 *   --canon    directory holding header.html and footer.html (default: stardust/canon)
 *   --content  root of the authored content tree (default: content)
 *   --prefix   a locale folder such as fr or ca/en (leading/trailing / stripped; segments lower-case [a-z0-9-],
 *              as EDS serves them) → <content>/<prefix>/nav.html and footer.html, served at /<prefix>/nav, /<prefix>/footer
 *   --check    write nothing: compare the built documents with the files on disk
 *
 * Document shape: the body fragment of deploy Step 9 (<body>, empty <header>, <main> of <div> sections, empty
 * <footer>), 2-space indentation, attributes href → src → alt, text and attribute values escaped (& < > ")
 * after the source's entities are decoded. Each document ends with a metadata section `Robots | noindex` (the
 * platform sitemap leaves chrome out). Hrefs and labels are verbatim: no URL rewriting (run localize-links.mjs
 * after). A link's label is its text, whitespace collapsed; an icon-only link: its <img>, else aria-label, else title.
 *   nav.html     section 1 brand: the first <a> holding an <img>/<picture>/<svg>, else one whose class, id or
 *                aria-label matches logo|brand, else one with href "/" (none: an empty section, `brand 0`)
 *                section 2 links: the top-level <ul>/<ol> with the most links, lists inside <nav> first, as a clean
 *                <ul> with nesting kept; a trigger without href keeps its label text (no list: an empty section)
 *                section 3 tools: every other link as <p><a>, every other list as <ul>, in document order
 *   footer.html  one section per footer band — the element children of <footer>, through single-child wrappers
 *                (a run of inline children is one band): headings, lists, paragraphs (inline <a>, <strong>, <em>,
 *                <img> kept, other inline tags flattened to text), a standalone link or image as <p>, loose text as <p>
 *   Controls — buttons, forms, inputs, links whose href is empty, "#" or javascript: — are not authored (the header
 *   and footer block JS renders them) and are counted as skipped.
 *
 * Writes: <content>[/<prefix>]/nav.html and footer.html, only when the bytes change (atomic temp file + rename).
 * Nothing with --check or --help.
 *
 * Stdout, one line per document:
 *   nav <path>: written|unchanged|matches|differs (first difference at line <n>)|missing (brand <0|1>, links <n>, tools <n>, skipped <n> control(s))
 *   footer <path>: … (bands <n>, links <n>, skipped <n> control(s))
 * links / tools count the authored <a href>. A canon source that is missing goes to stderr.
 *
 * Exit codes: 0 ok; 1 usage error or a canon source missing (the other document is still handled);
 * 2 --check found a difference or a missing document. Dependency-free.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ----------------------------------------------------------------- HTML tree reader --- */
// The node shape of spec/scripts/lib.mjs parseHTML ({ tag, attrs, children, text, parent }), kept here so the
// script runs standalone from a project copy. Whitespace-only text is kept: it separates inline links and words.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template']);
const IMPLIED = {
  p: /^(address|article|aside|blockquote|div|dl|fieldset|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/,
  li: /^li$/, dt: /^(dt|dd)$/, dd: /^(dt|dd)$/, option: /^(option|optgroup)$/, tr: /^tr$/, td: /^(td|th|tr)$/, th: /^(td|th|tr)$/,
};
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', AMP: '&', LT: '<', GT: '>', QUOT: '"' };
const REF = /^#?[a-z0-9]+;/i;

/**
 * Decode the common named entities and numeric references. Pure. A reference it does not decode (`&copy;`) stays
 * as written, and so does an `&amp;` that would form a reference with what follows (`&amp;copy;`): escapeHtml
 * passes both through, so neither changes meaning on the way out.
 */
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, e, off, str) => {
    let ch;
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) ch = String.fromCodePoint(n);
    } else ch = ENT[e];
    if (ch === undefined || (ch === '&' && REF.test(str.slice(off + m.length)))) return m;
    return ch;
  });
}

/** Escape & < > " for text and attribute values; an `&` that starts a character reference is left as is. Pure. */
export const escapeHtml = (s) => String(s).replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseAttrs(src) {
  const attrs = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** Parse HTML into { tag, attrs, children, parent } elements and { text, parent } text nodes. Tolerant. Pure. */
export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>/g;
  let last = 0; let m;
  const pushText = (t) => { if (t) cur.children.push({ text: decode(t), parent: cur }); };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[1]) continue;
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    while (IMPLIED[cur.tag] && IMPLIED[cur.tag].test(tag)) cur = cur.parent;
    const el = { tag, attrs: parseAttrs(m[2]), children: [], parent: cur };
    cur.children.push(el);
    if (VOID.has(tag) || m[3] === '/') continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const body = html.slice(last, end < 0 ? html.length : end);
      if (tag === 'title' || tag === 'textarea') el.children.push({ text: decode(body), parent: el });
      else el.raw = body;
      last = end < 0 ? html.length : html.indexOf('>', end) + 1;
      re.lastIndex = last;
      continue;
    }
    cur = el;
  }
  pushText(html.slice(last));
  return root;
}

function* walk(node) {
  for (const ch of node.children || []) {
    if (ch.tag) { yield ch; yield* walk(ch); }
  }
}
const first = (node, tag) => { for (const n of walk(node)) if (n.tag === tag) return n; return null; };
const isInside = (n, anc) => { for (let p = n.parent; p; p = p.parent) if (p === anc) return true; return false; };
const hasAncestor = (n, tags) => { for (let p = n.parent; p; p = p.parent) if (tags.includes(p.tag)) return true; return false; };

/* ------------------------------------------------------------------- content model --- */
// HTML whitespace only: a no-break space is content and survives (sanitise.js entity-encodes it before a DA write).
const WS = /[ \t\n\r\f]+/g;
const hasContent = (s) => /[^ \t\n\r\f]/.test(s);
const collapse = (s) => String(s || '').replace(WS, ' ').replace(/^ /, '').replace(/ $/, '');
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'img', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'picture', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'time', 'u', 'var', 'wbr']);
const DROP = new Set(['script', 'style', 'noscript', 'template', 'title', 'svg', 'iframe', 'video', 'audio', 'canvas', 'object', 'embed',
  'map', 'link', 'meta', 'hr', 'head']);
const CONTROLS = new Set(['button', 'form', 'input', 'select', 'textarea']);
const WRAPPERS = new Set(['div', 'section', 'nav', 'aside', 'article', 'main', 'header', 'footer', 'center']);
const HEADING = /^h[1-6]$/;

/** The href a link navigates to, trimmed; null for a control link (no href, empty, "#", javascript:). */
function realHref(a) {
  const h = (a.attrs.href ?? '').trim();
  return !h || h === '#' || /^javascript:/i.test(h) ? null : h;
}

/** Text as rendered, roughly: svg and raw-text elements left out, block boundaries and <br> become spaces. */
function rawText(node) {
  let s = '';
  for (const ch of node.children || []) {
    if (!ch.tag) s += ch.text;
    else if (ch.tag === 'br') s += ' ';
    else if (!DROP.has(ch.tag)) s += INLINE.has(ch.tag) ? rawText(ch) : ` ${rawText(ch)} `;
  }
  return s;
}

function imgSrc(img) {
  for (const v of [img.attrs.src, img.attrs['data-src']]) if (v && v.trim()) return v.trim();
  const set = img.attrs.srcset || img.attrs['data-srcset'];
  return set && set.trim() ? set.trim().split(/[\s,]+/)[0] : null;
}

/** The first image under (or at) el: { src, alt }; a <picture> without an <img> src falls back to its first <source>. */
function imageOf(el) {
  for (const n of [el, ...walk(el)]) {
    if (n.tag !== 'img') continue;
    let src = imgSrc(n);
    if (!src && n.parent?.tag === 'picture') src = n.parent.children.filter((c) => c.tag === 'source').map(imgSrc).find(Boolean) || null;
    if (src) return { src, alt: collapse(n.attrs.alt ?? '') };
  }
  return null;
}
const imgHtml = (img) => `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}">`;

function svgTitle(el) {
  for (const n of walk(el)) {
    if (n.tag === 'svg') { const t = first(n, 'title'); if (t) return collapse(rawText(t)); }
  }
  return '';
}

/** A control's or a trigger's label text, escaped; '' when it has none. */
function plainLabel(el) {
  for (const v of [rawText(el), el.attrs['aria-label'], el.attrs.title, svgTitle(el)]) { const t = collapse(v); if (t) return escapeHtml(t); }
  return '';
}

/** `<a href>label</a>`: the text; an icon-only link its <img>, else aria-label, else title (else the href, noted). */
function linkHtml(a, ctx) {
  const href = realHref(a);
  const text = collapse(rawText(a));
  let label = text ? escapeHtml(text) : '';
  if (!label) { const img = imageOf(a); if (img) label = imgHtml(img); }
  if (!label) label = plainLabel(a);
  if (!label) { label = escapeHtml(href); ctx.notes.push(`a link without a label is authored with its href as the text: ${href}`); }
  ctx.links += 1;
  return `<a href="${escapeHtml(href)}">${label}</a>`;
}

/* --------------------------------------------------------------------- inline runs --- */
// Tokens: { text } | { atom } (a link or an image) | { open } / { close } (<strong>, <em>).
function inlineTokens(children, ctx, out = []) {
  for (const ch of children) {
    if (!ch.tag) { out.push({ text: ch.text }); continue; }
    const t = ch.tag;
    if (DROP.has(t) || t === 'ul' || t === 'ol') continue; // a nested list belongs to the caller (a list item)
    if (t === 'br') out.push({ text: ' ' });
    else if (CONTROLS.has(t)) ctx.skipped += 1;
    else if (t === 'a') { if (realHref(ch)) out.push({ atom: linkHtml(ch, ctx) }); else ctx.skipped += 1; }
    else if (t === 'img' || t === 'picture') { const img = imageOf(ch); if (img) out.push({ atom: imgHtml(img) }); }
    else if (t === 'strong' || t === 'em') {
      const inner = inlineTokens(ch.children, ctx);
      if (inner.some((k) => k.atom || (k.text !== undefined && hasContent(k.text)))) out.push({ open: `<${t}>` }, ...inner, { close: `</${t}>` });
      else out.push(...inner);
    } else if (INLINE.has(t)) inlineTokens(ch.children, ctx, out);
    else { out.push({ text: ' ' }); inlineTokens(ch.children, ctx, out); out.push({ text: ' ' }); }
  }
  return out;
}

/** Tokens → one line of HTML: whitespace collapsed across tags, ends trimmed, a space never left inside a tag pair's edge. */
function renderInline(tokens) {
  let out = ''; let space = false; let started = false;
  for (const k of tokens) {
    if (k.text !== undefined) {
      const s = k.text.replace(WS, ' ');
      const core = s.replace(/^ /, '').replace(/ $/, '');
      if (s.startsWith(' ')) space = true;
      if (core) { if (space && started) out += ' '; out += escapeHtml(core); started = true; space = s.endsWith(' '); }
    } else if (k.atom !== undefined) { if (space && started) out += ' '; out += k.atom; started = true; space = false; }
    else if (k.open !== undefined) { if (space && started) out += ' '; out += k.open; space = false; }
    else out += k.close;
  }
  return out;
}

/* ---------------------------------------------------------------- output document --- */
// A block node is { open, kids, close } (rendered over several lines unless it has no kids) or a one-line string.
const block = (open, kids, close) => ({ open, kids, close });
function render(node, depth) {
  const pad = '  '.repeat(depth);
  if (typeof node === 'string') return [`${pad}${node}`];
  if (!node.kids.length) return [`${pad}${node.open}${node.close}`];
  return [`${pad}${node.open}`, ...node.kids.flatMap((k) => render(k, depth + 1)), `${pad}${node.close}`];
}
const ROBOTS = block('<div>', [block('<div class="metadata">', ['<div><div>Robots</div><div>noindex</div></div>'], '</div>')], '</div>');
function documentHtml(sections) {
  return ['<body>', '  <header></header>', '  <main>', ...[...sections, ROBOTS].flatMap((s) => render(s, 2)), '  </main>',
    '  <footer></footer>', '</body>', ''].join('\n');
}
const section = (kids) => block('<div>', kids.filter(Boolean), '</div>');

/* ---------------------------------------------------------------------------- nav --- */
const BUTTONLIKE = new Set(['button', 'summary']);

/** A nav list item's parts in document order: text runs, links, nested lists. */
function navParts(li, ctx) {
  const parts = []; let joinable = false;
  const visit = (node) => {
    for (const ch of node.children) {
      if (!ch.tag) {
        if (hasContent(ch.text)) {
          if (joinable && parts.at(-1)?.kind === 'text') parts.at(-1).raw += ch.text; else parts.push({ kind: 'text', raw: ch.text });
          joinable = true;
        } else if (joinable && parts.at(-1)?.kind === 'text') parts.at(-1).raw += ch.text;
        continue;
      }
      const t = ch.tag;
      if (ctx.isBrand(ch) || DROP.has(t) || t === 'img' || t === 'picture') { joinable = false; continue; }
      if (t === 'br') { if (joinable && parts.at(-1)?.kind === 'text') parts.at(-1).raw += ' '; continue; }
      if (t !== 'a' && INLINE.has(t)) { visit(ch); continue; } // a <span> continues the text run around it
      joinable = false;
      if (t === 'a') {
        if (realHref(ch)) parts.push({ kind: 'link', html: linkHtml(ch, ctx) });
        else if (!parts.length && plainLabel(ch)) parts.push({ kind: 'trigger', html: plainLabel(ch) });
        else ctx.skipped += 1;
      } else if (BUTTONLIKE.has(t) && !parts.length && plainLabel(ch)) parts.push({ kind: 'trigger', html: plainLabel(ch) });
      else if (BUTTONLIKE.has(t) || CONTROLS.has(t)) ctx.skipped += 1;
      else if (t === 'ul' || t === 'ol') parts.push({ kind: 'list', el: ch });
      else { visit(ch); joinable = false; }
    }
  };
  visit(li);
  return parts.map((p) => (p.kind === 'text' ? { kind: 'text', html: escapeHtml(collapse(p.raw)) } : p)).filter((p) => p.kind === 'list' || p.html);
}

/**
 * `<li>head<ul>…</ul></li>`: the head is the first link or text (a trigger without href: its label); what follows
 * becomes the sub-list — a nested list's items, a text or link directly followed by a list as `<li>label<ul>…`
 * (a mega-menu column heading), any other link or text as its own item.
 */
function navItem(li, ctx) {
  const parts = navParts(li, ctx);
  if (!parts.length) return null;
  const head = parts[0].kind === 'list' ? '' : parts.shift().html;
  const items = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]; const next = parts[i + 1];
    if (p.kind === 'list') items.push(...navItems(p.el, ctx));
    else if (next?.kind === 'list') {
      const sub = navItems(next.el, ctx); i += 1;
      items.push(sub.length ? block(`<li>${p.html}`, [block('<ul>', sub, '</ul>')], '</li>') : `<li>${p.html}</li>`);
    } else items.push(`<li>${p.html}</li>`);
  }
  if (!items.length) return head ? `<li>${head}</li>` : null;
  return block(`<li>${head}`, [block('<ul>', items, '</ul>')], '</li>');
}

function navItems(list, ctx) {
  const items = [];
  for (const ch of list.children) {
    if (!ch.tag || DROP.has(ch.tag) || ctx.isBrand(ch)) continue;
    if (ch.tag === 'li') { const it = navItem(ch, ctx); if (it) items.push(it); } else if (CONTROLS.has(ch.tag) || BUTTONLIKE.has(ch.tag)) ctx.skipped += 1;
    else items.push(...navItems(ch, ctx)); // a wrapper element inside the list
  }
  return items;
}
const navList = (list, ctx) => { const items = navItems(list, ctx); return items.length ? block('<ul>', items, '</ul>') : null; };

/** canon header HTML → { doc, counts: { brand, links, tools, skipped }, notes }. Pure. */
export function buildNav(html) {
  const root = parseHTML(String(html));
  const box = first(root, 'header') || first(root, 'body') || root;
  const anchors = [...walk(box)].filter((n) => n.tag === 'a' && realHref(n));
  const brand = anchors.find((a) => [...walk(a)].some((n) => n.tag === 'img' || n.tag === 'picture' || n.tag === 'svg'))
    || anchors.find((a) => [a.attrs.class, a.attrs.id, a.attrs['aria-label']].some((v) => /logo|brand/i.test(v || '')))
    || anchors.find((a) => realHref(a) === '/') || null;
  const ctx = { links: 0, skipped: 0, notes: [], isBrand: (n) => Boolean(brand) && (n === brand || isInside(n, brand)) };

  const lists = [...walk(box)].filter((n) => (n.tag === 'ul' || n.tag === 'ol') && !hasAncestor(n, ['ul', 'ol']) && !ctx.isBrand(n));
  const linkCount = (l) => [...walk(l)].filter((n) => n.tag === 'a' && realHref(n) && !ctx.isBrand(n)).length;
  const inNav = (l) => hasAncestor(l, ['nav']);
  const linked = lists.filter((l) => linkCount(l) > 0);
  const pool = [linked.filter(inNav), linked, lists.filter(inNav), lists].find((p) => p.length) || [];
  let main = null;
  for (const l of pool) if (!main || linkCount(l) > linkCount(main)) main = l;

  const brandSection = [];
  if (brand) {
    const img = imageOf(brand); const text = collapse(rawText(brand));
    let inner = [img ? imgHtml(img) : '', text ? escapeHtml(text) : ''].filter(Boolean).join(' ');
    if (!inner) inner = plainLabel(brand) || escapeHtml(realHref(brand));
    brandSection.push(`<p><a href="${escapeHtml(realHref(brand))}">${inner}</a></p>`);
  }
  const linkSection = main ? [navList(main, ctx)] : [];
  const links = ctx.links;
  ctx.links = 0;

  const tools = [];
  const visit = (node) => {
    for (const ch of node.children) {
      if (!ch.tag || ch === main || ctx.isBrand(ch) || DROP.has(ch.tag)) continue;
      if (ch.tag === 'a') { if (realHref(ch)) tools.push(`<p>${linkHtml(ch, ctx)}</p>`); else ctx.skipped += 1; }
      else if (ch.tag === 'ul' || ch.tag === 'ol') tools.push(navList(ch, ctx));
      else if (CONTROLS.has(ch.tag) || BUTTONLIKE.has(ch.tag)) ctx.skipped += 1;
      else visit(ch);
    }
  };
  visit(box);
  const doc = documentHtml([section(brandSection), section(linkSection), section(tools)]);
  return { doc, counts: { brand: brand ? 1 : 0, links, tools: ctx.links, skipped: ctx.skipped }, notes: ctx.notes };
}

/* ------------------------------------------------------------------------- footer --- */
function footerItems(list, ctx) {
  const items = [];
  for (const ch of list.children) {
    if (!ch.tag || DROP.has(ch.tag)) continue;
    if (ch.tag === 'li') { const it = footerItem(ch, ctx); if (it) items.push(it); } else if (CONTROLS.has(ch.tag)) ctx.skipped += 1;
    else items.push(...footerItems(ch, ctx));
  }
  return items;
}
const footerList = (list, ctx) => { const items = footerItems(list, ctx); return items.length ? block(`<${list.tag}>`, items, `</${list.tag}>`) : null; };

/** The lists under node that are not inside another list below it, in document order. */
function topLists(node, out = []) {
  for (const ch of node.children) {
    if (!ch.tag || DROP.has(ch.tag) || CONTROLS.has(ch.tag)) continue;
    if (ch.tag === 'ul' || ch.tag === 'ol') out.push(ch); else topLists(ch, out);
  }
  return out;
}

function footerItem(li, ctx) {
  const head = renderInline(inlineTokens(li.children, ctx));
  const subs = topLists(li).map((l) => footerList(l, ctx)).filter(Boolean);
  if (!subs.length) return head ? `<li>${head}</li>` : null;
  return block(`<li>${head}`, subs, '</li>');
}

/** A band's default content in document order. */
function footerBlocks(nodes, ctx) {
  const out = [];
  let run = [];
  const flush = () => { const h = renderInline(run); run = []; if (h) out.push(`<p>${h}</p>`); };
  const visit = (list) => {
    for (const ch of list) {
      if (!ch.tag) { run.push({ text: ch.text }); continue; }
      const t = ch.tag;
      if (DROP.has(t)) continue;
      if (t === 'br') run.push({ text: ' ' });
      else if (t === 'form') { flush(); ctx.skipped += 1; }
      else if (CONTROLS.has(t)) ctx.skipped += 1;
      else if (t === 'a') { if (realHref(ch)) { flush(); out.push(`<p>${linkHtml(ch, ctx)}</p>`); } else ctx.skipped += 1; }
      else if (t === 'img' || t === 'picture') { const img = imageOf(ch); if (img) { flush(); out.push(`<p>${imgHtml(img)}</p>`); } }
      else if (HEADING.test(t) || t === 'p') { flush(); const h = renderInline(inlineTokens(ch.children, ctx)); if (h) out.push(`<${t}>${h}</${t}>`); }
      else if (t === 'ul' || t === 'ol') { flush(); const l = footerList(ch, ctx); if (l) out.push(l); }
      else if (t === 'strong' || t === 'em') inlineTokens([ch], ctx, run);
      else if (INLINE.has(t)) visit(ch.children);
      else { flush(); visit(ch.children); flush(); }
    }
  };
  visit(nodes);
  flush();
  return out;
}

/** canon footer HTML → { doc, counts: { bands, links, skipped }, notes }. Pure. */
export function buildFooter(html) {
  const root = parseHTML(String(html));
  let box = first(root, 'footer') || first(root, 'body') || root;
  const elementKids = (n) => n.children.filter((c) => c.tag && !DROP.has(c.tag) && c.tag !== 'br');
  for (;;) {
    const kids = elementKids(box);
    if (kids.length === 1 && WRAPPERS.has(kids[0].tag) && !box.children.some((c) => !c.tag && hasContent(c.text))) box = kids[0];
    else break;
  }
  // Each element child is a band, kept even when it authors nothing (a form-only band) so section n stays band n;
  // a run of text and inline children is one band, dropped when it authors nothing.
  const bands = [];
  let run = null;
  for (const ch of box.children) {
    if (!ch.tag) { if (hasContent(ch.text) && !run) bands.push(run = Object.assign([], { inline: true })); if (run) run.push(ch); continue; }
    if (DROP.has(ch.tag)) continue;
    if (ch.tag === 'br') { if (run) run.push(ch); continue; }
    if (INLINE.has(ch.tag)) { if (!run) bands.push(run = Object.assign([], { inline: true })); run.push(ch); continue; }
    run = null;
    bands.push([ch]);
  }
  const ctx = { links: 0, skipped: 0, notes: [] };
  const sections = bands.map((b) => ({ inline: b.inline, kids: footerBlocks(b, ctx) })).filter((s) => !s.inline || s.kids.length);
  const doc = documentHtml(sections.map((s) => section(s.kids)));
  return { doc, counts: { bands: sections.length, links: ctx.links, skipped: ctx.skipped }, notes: ctx.notes };
}

/* --------------------------------------------------------------------------- CLI --- */
class UsageError extends Error {}
const USAGE = 'usage: chrome-docs.mjs [--canon stardust/canon] [--content content] [--prefix <locale>] [--check] [--help]';

/** `fr`, `/ca/en/` → `fr`, `ca/en`; a segment EDS would not serve as written is a usage error. Pure. */
export function normalizePrefix(raw) {
  const p = String(raw).replace(/^\/+|\/+$/g, '');
  if (!p) throw new UsageError('--prefix is empty once leading and trailing / are stripped');
  for (const s of p.split('/')) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
      const served = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      throw new UsageError(`--prefix segment "${s}" is not a path segment EDS serves (lower-case [a-z0-9-])${served ? `: use "${served}"` : ''}`);
    }
  }
  return p;
}

/** argv (without node and the script) → { canon, content, prefix, check }. Throws UsageError. Pure. */
export function parseArgs(argv) {
  const opts = { canon: 'stardust/canon', content: 'content', prefix: '', check: false };
  const value = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--canon') { opts.canon = value(i); i += 1; }
    else if (a === '--content') { opts.content = value(i); i += 1; }
    else if (a === '--prefix') { opts.prefix = normalizePrefix(value(i)); i += 1; }
    else if (a === '--check') opts.check = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  return opts;
}

/** 1-based number of the first line where a and b differ. Pure. */
export function firstDifferenceLine(a, b) {
  const x = a.split('\n'); const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if (x[i] !== y[i]) return i + 1;
  return 1;
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function main(argv) {
  // --help prints this file's usage header before any other I/O, so an agent never reads the source to learn the flags.
  if (argv.includes('--help') || argv.includes('-h')) {
    const header = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : USAGE);
    return 0;
  }
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`chrome-docs: ${e.message}\n${USAGE}`);
    return 1;
  }
  const dir = opts.prefix ? path.join(opts.content, ...opts.prefix.split('/')) : opts.content;
  const jobs = [
    { name: 'nav', src: path.join(opts.canon, 'header.html'), out: path.join(dir, 'nav.html'), build: buildNav,
      summary: (c) => `brand ${c.brand}, links ${c.links}, tools ${c.tools}, skipped ${c.skipped} control(s)` },
    { name: 'footer', src: path.join(opts.canon, 'footer.html'), out: path.join(dir, 'footer.html'), build: buildFooter,
      summary: (c) => `bands ${c.bands}, links ${c.links}, skipped ${c.skipped} control(s)` },
  ];
  let sourceMissing = false; let differs = false;
  for (const job of jobs) {
    let html;
    try {
      if (!statSync(job.src).isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTFILE' });
      html = readFileSync(job.src, 'utf8');
    } catch (e) {
      console.error(`chrome-docs: ${job.name}: canon source ${job.src} ${e.code === 'ENOENT' ? 'missing' : `unreadable (${e.code || e.message})`} — ${job.out} not built`);
      sourceMissing = true;
      continue;
    }
    const { doc, counts, notes } = job.build(html);
    for (const n of notes) console.error(`chrome-docs: ${job.name}: ${n}`);
    const bytes = Buffer.from(doc, 'utf8');
    const prev = existsSync(job.out) && statSync(job.out).isFile() ? readFileSync(job.out) : null;
    let status;
    if (opts.check) {
      if (!prev) status = 'missing';
      else if (prev.equals(bytes)) status = 'matches';
      else status = `differs (first difference at line ${firstDifferenceLine(prev.toString('utf8'), doc)})`;
      if (status !== 'matches') differs = true;
    } else if (prev && prev.equals(bytes)) status = 'unchanged';
    else { writeAtomic(job.out, doc); status = 'written'; }
    console.log(`${job.name} ${job.out}: ${status} (${job.summary(counts)})`);
  }
  return sourceMissing ? 1 : differs ? 2 : 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op, and a test that
// imports the pure parts must not run it.
const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`chrome-docs: ${e.message}`); process.exit(1); }
}
