#!/usr/bin/env node
/**
 * skills/deploy/scripts/proto-to-doc.mjs — a gated prototype's <main> → the delivered document (content/<da-path>.html)
 * in the migrate encoder's document form, so no run hand-writes a generator for it. Offline: no browser, no network.
 *
 * Usage:
 *   node skills/deploy/scripts/proto-to-doc.mjs <prototype.html> --path </da/path> [--out <file>] [--page <page.json>]
 *        [--media-map <file>] [--media-ledger <file>] [--json]
 *   --path          the page's DA path: starts with /, holds no `..`; through eds-path.mjs (deliveredUrl, then daPath —
 *                   a trailing / or / alone → <path>/index) it names the default --out content/<da-path>.html (cwd)
 *   --out           the document to write instead
 *   --page          the page record: Title ← title, Description ← metaDescription || description (default
 *                   <prototype dir>/../current/pages/<slug>.json when present; slug = the file name minus
 *                   -proposed.html or .html). A row it leaves empty comes from the prototype's <title> /
 *                   <meta name="description">; an empty row is omitted.
 *   --media-map     extract's media map (default stardust/current/assets/media-map.json when present)
 *   --media-ledger  deploy's media ledger (default stardust/deploy/media-ledger.json when present)
 *   --json          print the record below instead of the line
 *
 * Sections — section-schema's default reading: each outermost <section> / [data-section] in <main> is one (an element
 * holding one is unwrapped; the content around them is grouped as below); a <main> without either is grouped by
 * section-schema's groupSections (the --split rule) over its element children. A section with nothing to deliver is
 * left out.
 * Blocks — an element with data-block (wins) or data-module → <div class="<name>[ <variant>…]"> (lower case, runs
 * outside [a-z0-9] → -, trimmed; variants: data-variant, space-separated). Single-container wrappers of the block root
 * are unwrapped. When its children hold a repeat group (≥ 2 with the same tag and first class; <br> never), each
 * member of the first one is a row and the children before / after the group are default content before / after the
 * block; else the root is ONE row. A row that is an image is one image cell; a row that is content (p, h1–h6, a, …)
 * is one cell; else its children make the cells: each image (img, picture, a figure holding only one) and each
 * container (div, section, article, aside, header, footer, nav, form, figure) is a cell, each run of other children
 * is one. A marker inside a block is content (no nested tables).
 * Default content — kept: h1–h6, p, ul, ol, li, blockquote, pre, code, table/thead/tbody/tr/th/td, a, strong, em, b
 * (→ strong), i (→ em), u, s, sub, sup, br, img; dropped: script, style, template, noscript, svg, button, input,
 * select, textarea, hr, link, meta, comments; figcaption → <p>; every other element unwrapped (picture → its img);
 * a run of text and inline elements → one <p>, an image alone → <p><img></p>. An <a> without a usable href (none, #,
 * javascript:) is unwrapped; an <a> holding blocks is unwrapped and its link moves onto the first heading (else
 * paragraph) inside. Attributes kept: a[href,title], img[src,alt] (alt="" when absent), th/td[colspan,rowspan].
 * Media — an <img src> is resolved against the prototype's directory; a media-map entry (status ok) whose `local`
 * (project-relative) is that file names its source URL; a ledger entry (status uploaded) whose sources[] / source
 * holds that URL — or the src itself when absolute — gives its contentUrl. Otherwise the src stays (the source URL
 * when mapped, else as written) and is listed as unmapped.
 * Form — the encoder's: <body>, <header></header>, <main>, the metadata block alone in the first section, one <div>
 * per section, </main>, <footer></footer>, </body>; one element per line, no indentation, block rows one per line;
 * whitespace as the encoder's tidy (ASCII runs → one space, trimmed at line edges and <br>, NBSP kept, pre/code
 * verbatim). Entities: text keeps its source bytes (entities as written; a bare & or < escaped); attribute values are
 * decoded once (dom.mjs) and re-escaped (&, <, >, "); page-record values are escaped in full. Deterministic.
 *
 * Writes: only the out file (parents created, tmp + rename; an identical file is not rewritten).
 * stdout: `proto-to-doc: <proto> → <out> — <n> section(s), <k> block(s)[ (a, b)], metadata: Title, Description
 *   [; <u> image(s) unmapped][ (unchanged)]` (metadata: none without a row); with --json instead
 *   { prototype, path, out, written, sections, blocks: [{ name, rows, cells }], metadata: { Title?, Description? },
 *     unmapped: [<src>, …] } (unmapped sorted; cells = the block's total).
 * Exit codes: 0 ok · 1 usage · 2 refused — 1 also for an unreadable input; 2 = no <main>, or one with nothing to
 *   deliver (nothing written).
 * Needs migrate's encode/dom.mjs: skills/migrate/scripts/encode/ (plugin) or stardust/scripts/migrate/encode/ (project copy).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { daPath, deliveredUrl } from './eds-path.mjs';
import { CONTAINER_TAGS, MARK_ATTRS, groupSections } from './section-schema.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const USAGE = 'usage: node skills/deploy/scripts/proto-to-doc.mjs <prototype.html> --path </da/path> [--out <file>] [--page <page.json>] [--media-map <file>] [--media-ledger <file>] [--json]';
const fail = (code, msg) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const usage = (msg) => fail(1, `proto-to-doc: ${msg}\n${USAGE}`);

const VALUED = { '--path': 'path', '--out': 'out', '--page': 'page', '--media-map': 'mediaMap', '--media-ledger': 'mediaLedger' };
const a = { json: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const k = argv[i];
  if (k === '--json') a.json = true;
  else if (VALUED[k]) { const v = argv[i += 1]; if (!v || v.startsWith('--')) usage(`${k} needs a value`); a[VALUED[k]] = v; }
  else if (k.startsWith('-') || a.proto) usage(`unknown argument ${k}`);
  else a.proto = k;
}
if (!a.proto) usage('name the prototype');
if (!a.path) usage('--path </da/path> is required');
if (!a.path.startsWith('/') || a.path.includes('..')) usage(`--path ${a.path}: a DA path starts with / and holds no ..`);
const da = daPath(deliveredUrl(a.path));
const out = a.out || `content${da}.html`;

const HERE = dirname(fileURLToPath(import.meta.url));
const DOM = [join(HERE, '..', '..', 'migrate', 'scripts', 'encode', 'dom.mjs'), join(HERE, '..', 'migrate', 'encode', 'dom.mjs')].find((p) => existsSync(p));
if (!DOM) fail(1, 'proto-to-doc: migrate\'s encode/dom.mjs not found (../../migrate/scripts/encode/ in the plugin, ../migrate/encode/ in a stardust/scripts/ copy)');
const { attr, decodeEntities, isEl, kids, parseHTML, qs, qsa, textOf } = await import(pathToFileURL(DOM).href);

const readJson = (file, what) => {
  let v;
  try { v = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { usage(`${what} ${file}: ${e.code === 'ENOENT' ? 'not found' : `unreadable (${e.code || e.message})`}`); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) usage(`${what} ${file}: not a JSON object`);
  return v;
};
const optional = (given, def, what) => (given ? readJson(given, what) : existsSync(def) ? readJson(def, what) : {});
let html;
try { html = readFileSync(a.proto, 'utf8'); } catch (e) { usage(`cannot read ${a.proto} (${e.code || e.message})`); }

// ---- output nodes, text and whitespace (the encoder's tidy, on our own tree) ----
const el = (tag, attrs = [], children = []) => ({ tag, attrs, kids: children });
const WS = /[\t\n\f\r ]+/g;
const VOID = new Set(['br', 'img']);
const BLOCKS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre', 'table']);
const LINE = new Set([...BLOCKS, 'li', 'thead', 'tbody', 'tr', 'th', 'td']);
const escText = (t) => String(t).replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (t) => escText(t).replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escPlain = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const collapse = (s) => String(s).replace(WS, ' ').replace(/^ | $/g, '');
const textOut = (x) => (x.text !== undefined ? x.text : x.kids.map(textOut).join(''));
const hasTag = (x, t) => x.tag === t || (x.kids || []).some((k) => hasTag(k, t));
const filled = (s) => decodeEntities(s).replace(/[\s\u00a0]+/g, '') !== '';
const blank = (x) => !hasTag(x, 'img') && !filled(textOut(x));
function squash(root) {
  let last = null; let atStart = true; let endsSpace = false;
  const endLine = () => { if (last) last.text = last.text.replace(/[\t\n\f\r ]+$/, ''); last = null; atStart = true; endsSpace = false; };
  const visit = (x) => {
    if (x.text !== undefined) {
      let t = x.text.replace(WS, ' ');
      if (atStart || endsSpace) t = t.replace(/^ /, '');
      x.text = t;
      if (t) { atStart = false; endsSpace = t.endsWith(' '); last = x; }
      return;
    }
    if (x.tag === 'pre') { endLine(); return; }
    if (x.tag === 'br') { endLine(); return; }
    if (x.tag === 'code' || VOID.has(x.tag)) { atStart = false; endsSpace = false; last = null; return; }
    if (LINE.has(x.tag)) endLine();
    x.kids.forEach(visit);
    if (LINE.has(x.tag)) endLine();
  };
  visit(root); endLine();
}
const ser = (x) => {
  if (x.text !== undefined) return escText(x.text);
  const at = x.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  return VOID.has(x.tag) ? `<${x.tag}${at}>` : `<${x.tag}${at}>${x.kids.map(ser).join('')}</${x.tag}>`;
};
const line = (x) => { squash(x); return ser(x); };

// ---- media: prototype file → source URL (media map) → contentUrl (ledger) ----
const noHash = (u) => u.split('#')[0];
const byLocal = new Map();
const mediaMap = optional(a.mediaMap, 'stardust/current/assets/media-map.json', '--media-map');
for (const k of Object.keys(mediaMap).sort()) {
  const e = mediaMap[k];
  if (e && e.status === 'ok' && typeof e.local === 'string' && !byLocal.has(resolve(e.local))) byLocal.set(resolve(e.local), noHash(k));
}
const byUrl = new Map();
const ledger = optional(a.mediaLedger, 'stardust/deploy/media-ledger.json', '--media-ledger');
for (const k of Object.keys(ledger).sort()) {
  const e = ledger[k];
  if (!e || e.status !== 'uploaded' || typeof e.contentUrl !== 'string') continue;
  for (const s of [...(Array.isArray(e.sources) ? e.sources : []), e.source]) if (typeof s === 'string' && s && !byUrl.has(noHash(s))) byUrl.set(noHash(s), e.contentUrl);
}
const protoDir = dirname(resolve(a.proto));
const unmapped = new Set();
function mediaSrc(src) {
  const absolute = /^https?:\/\//i.test(src);
  let source = absolute ? noHash(src) : null;
  if (!absolute && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
    let p = src.split(/[?#]/)[0];
    try { p = decodeURIComponent(p); } catch { /* a malformed escape: the path as written */ }
    source = byLocal.get(p.startsWith('/') ? join(protoDir, p) : resolve(protoDir, p)) || null;
  }
  if (source && byUrl.has(source)) return byUrl.get(source);
  const kept = source && !absolute ? source : src;
  unmapped.add(kept);
  return kept;
}
function image(n) {
  const img = n.tag === 'img' ? n : qs(n, 'img');
  const src = img ? (attr(img, 'src') || '').trim() : '';
  return src ? el('img', [['src', mediaSrc(src)], ['alt', attr(img, 'alt') || '']]) : null;
}

// ---- default content ----
const DROP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'button', 'input', 'select', 'textarea', 'hr', 'link', 'meta']);
const PHRASE = new Set(['a', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'code', 'br']);
const INLINE = new Set([...PHRASE, 'img', 'picture', 'source', 'span', 'small', 'label', 'time', 'mark', 'abbr', 'cite', 'q', 'dfn', 'kbd', 'samp', 'var', 'data', 'bdi', 'bdo', 'ins', 'del', 'font', 'wbr']);
const RETAG = { b: 'strong', i: 'em' };
const CELL = new Set([...CONTAINER_TAGS, 'figure']);
const isInline = (n) => INLINE.has(n.tag) && n.children.every((c) => !isEl(c) || DROP.has(c.tag) || isInline(c));
const isImage = (n) => n.tag === 'img' || n.tag === 'picture'
  || (n.tag === 'figure' && kids(n).filter((k) => !DROP.has(k.tag)).length === 1 && isImage(kids(n).find((k) => !DROP.has(k.tag)))
    && !n.children.some((c) => c.type === 'text' && filled(c.text)));
const linkAttrs = (n) => {
  const href = (attr(n, 'href') || '').trim();
  if (!href || href === '#' || /^javascript:/i.test(href)) return null;
  const title = attr(n, 'title');
  return [['href', href], ...(title && title.trim() ? [['title', title]] : [])];
};

// one source node → output nodes; mode: inline (phrasing only) · flow (inside li/blockquote/td) · list · table
function clean(n, mode) {
  if (!isEl(n)) return n.type === 'text' && (mode === 'inline' || mode === 'flow') ? [{ text: n.text }] : [];
  if (DROP.has(n.tag)) return [];
  const sub = (m) => n.children.flatMap((c) => clean(c, m));
  const tag = RETAG[n.tag] || n.tag;
  if (tag === 'img' || tag === 'picture') { const i = image(n); return i ? [i] : []; }
  if (mode === 'list') return tag === 'li' ? [el('li', [], sub('flow'))] : sub('list');
  if (mode === 'table') {
    if (tag === 'th' || tag === 'td') return [el(tag, ['colspan', 'rowspan'].filter((k) => attr(n, k) !== undefined).map((k) => [k, attr(n, k)]), sub('flow'))];
    return ['thead', 'tbody', 'tr'].includes(tag) ? [el(tag, [], sub('table'))] : sub('table');
  }
  if (tag === 'a') { const at = linkAttrs(n); return at ? [el('a', at, sub('inline'))] : sub(mode); }
  if (PHRASE.has(tag)) return [el(tag, [], VOID.has(tag) ? [] : sub('inline'))];
  if (mode === 'flow' && BLOCKS.has(tag)) return [block(n)];
  return sub(mode);
}
function block(n) {
  const mode = { ul: 'list', ol: 'list', table: 'table', blockquote: 'flow' }[n.tag] || 'inline';
  return el(n.tag, [], n.children.flatMap((c) => clean(c, mode)));
}

// the content of a container, in order → items: output elements and (outside a block) blocks { cls, rows }
function flow(nodes, items, inBlock) {
  let run = [];
  const push = (x) => { if (!blank(x)) items.push(x); };
  const flush = () => { if (run.length) push(el('p', [], run.flatMap((c) => clean(c, 'inline')))); run = []; };
  for (const c of nodes) {
    if (!isEl(c)) { if (c.type === 'text') run.push(c); continue; }
    if (DROP.has(c.tag)) continue;
    const cls = inBlock ? null : blockClass(c);
    if (!cls && isInline(c) && c.tag !== 'img' && c.tag !== 'picture') { run.push(c); continue; }
    flush();
    if (cls) items.push(...emitBlock(c, cls));
    else if (BLOCKS.has(c.tag)) push(block(c));
    else if (c.tag === 'img' || c.tag === 'picture') { const i = image(c); if (i) items.push(el('p', [], [i])); }
    else if (c.tag === 'a' && linkAttrs(c)) linked(c, items, inBlock);
    else flow(c.children, items, inBlock);
  }
  flush();
}
function linked(n, items, inBlock) {
  const from = items.length;
  flow(n.children, items, inBlock);
  const mine = items.slice(from).filter((x) => x.tag && !hasTag(x, 'a') && filled(textOut(x)));
  const target = mine.find((x) => /^h[1-6]$/.test(x.tag)) || mine.find((x) => x.tag === 'p');
  if (target) target.kids = [el('a', linkAttrs(n), target.kids)];
}

// ---- blocks ----
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function blockClass(n) {
  const name = norm(attr(n, 'data-block')) || norm(attr(n, 'data-module'));
  if (!name) return null;
  const variants = String(attr(n, 'data-variant') || '').split(/\s+/).map(norm).filter(Boolean);
  return [...new Set([name, ...variants])].join(' ');
}
const contentKids = (n) => kids(n).filter((k) => !DROP.has(k.tag));
function rowCells(row) {
  if (isImage(row)) { const i = image(row); return i ? [[i]] : []; }
  const cells = [];
  const add = (nodes) => { const items = []; flow(nodes, items, true); if (items.length) cells.push(items); };
  if (BLOCKS.has(row.tag) || isInline(row)) { add([row]); return cells; }
  let run = [];
  const flush = () => { if (run.length) add(run); run = []; };
  for (const c of row.children) {
    if (isEl(c) && DROP.has(c.tag)) continue;
    if (isEl(c) && isImage(c)) { flush(); const i = image(c); if (i) cells.push([i]); } else if (isEl(c) && CELL.has(c.tag)) { flush(); add(c.children); } else run.push(c);
  }
  flush();
  return cells;
}
function emitBlock(n, cls) {
  let root = n;
  const ownText = (x) => x.children.some((c) => c.type === 'text' && filled(c.text));
  for (let k = contentKids(root); k.length === 1 && CELL.has(k[0].tag) && !ownText(root); k = contentKids(root)) [root] = k;
  const key = (k) => `${k.tag}.${(attr(k, 'class') || '').trim().split(/\s+/)[0]}`;
  const members = contentKids(root).filter((k) => k.tag !== 'br');
  const first = members.find((k) => members.filter((m) => key(m) === key(k)).length >= 2);
  const before = []; const after = [];
  let rows;
  if (first) {
    const group = members.filter((m) => key(m) === key(first));
    const at = root.children.indexOf(first);
    flow(root.children.slice(0, at), before, true);
    flow(root.children.slice(at).filter((c) => !group.includes(c)), after, true);
    rows = group.map(rowCells);
  } else rows = [rowCells(root)];
  rows = rows.filter((r) => r.length);
  return [...before, ...(rows.length ? [{ cls, rows }] : []), ...after];
}

// ---- sections: section-schema's default reading of <main> ----
const doc = parseHTML(html);
const main = qs(doc, 'main');
const refuse = (why) => fail(2, `proto-to-doc: refused — ${a.proto} has no <main>${why}`);
if (!main) refuse(' — put the page\'s sections in one <main> (a <section> each) and run again');
const ADAPTER = { tagOf: (n) => n.tag, childrenOf: kids, isMarked: (n) => MARK_ATTRS.some((k) => attr(n, k) !== undefined) };
const SECTION_SEL = 'section, [data-section]';
function sectionGroups(m) {
  if (!qs(m, SECTION_SEL)) return groupSections(kids(m), ADAPTER);
  const groups = []; let run = [];
  const flush = () => { groups.push(...groupSections(run, ADAPTER)); run = []; };
  const visit = (list) => {
    for (const n of list) {
      if (n.tag === 'section' || attr(n, 'data-section') !== undefined) { flush(); groups.push([n]); } else if (qs(n, SECTION_SEL)) { flush(); visit(kids(n)); } else run.push(n);
    }
  };
  visit(kids(m)); flush();
  return groups;
}
const sections = sectionGroups(main).map((g) => { const items = []; flow(g, items, false); return items; }).filter((s) => s.length);
if (!sections.length) refuse(' content — it holds no element to deliver; put the page\'s sections inside <main> and run again');

// ---- metadata (the page record, else the prototype's <head>) ----
const slug = basename(a.proto).replace(/(-proposed)?\.html$/, '');
const defPage = join(dirname(a.proto), '..', 'current', 'pages', `${slug}.json`);
const rec = a.page ? readJson(a.page, '--page') : existsSync(defPage) ? readJson(defPage, 'page record') : {};
const str = (v) => (typeof v === 'string' ? v : '');
const titleEl = qs(doc, 'title:not(svg title)');
const descEl = qsa(doc, 'meta[name]').find((m) => attr(m, 'name').toLowerCase() === 'description');
const metadata = [
  ['Title', collapse(escPlain(str(rec.title))) || (titleEl ? collapse(escText(textOf(titleEl))) : '')],
  ['Description', collapse(escPlain(str(rec.metaDescription) || str(rec.description))) || (descEl ? collapse(escText(attr(descEl, 'content') || '')) : '')],
].filter(([, v]) => v);

// ---- the document ----
const serItem = (x) => (x.cls
  ? [`<div class="${x.cls}">`, ...x.rows.map((r) => `<div>${r.map((c) => `<div>${c.map(line).join('\n')}</div>`).join('')}</div>`), '</div>'].join('\n')
  : line(x));
const metaHtml = ['<div>', '<div class="metadata">', ...metadata.map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`), '</div>', '</div>'];
const body = `${['<body>', '<header></header>', '<main>', ...metaHtml, ...sections.map((s) => ['<div>', ...s.map(serItem), '</div>'].join('\n')), '</main>', '<footer></footer>', '</body>'].join('\n')}\n`;

const target = resolve(out);
let written;
let tmp;
try {
  written = !(existsSync(target) && readFileSync(target, 'utf8') === body);
  if (written) {
    mkdirSync(dirname(target), { recursive: true });
    tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, body);
    renameSync(tmp, target);
  }
} catch (e) {
  if (tmp) { try { rmSync(tmp, { force: true }); } catch { /* best effort: do not leave the temp file behind */ } }
  fail(1, `proto-to-doc: cannot write ${out} (${e.code || e.message})`);
}

const blocks = sections.flat().filter((x) => x.cls).map((b) => ({ name: b.cls, rows: b.rows.length, cells: b.rows.reduce((n, r) => n + r.length, 0) }));
const listed = [...unmapped].sort();
if (a.json) {
  const record = { prototype: a.proto, path: da, out, written, sections: sections.length, blocks, metadata: Object.fromEntries(metadata), unmapped: listed };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
} else {
  const names = blocks.length ? ` (${blocks.map((b) => b.name).join(', ')})` : '';
  const meta = metadata.length ? metadata.map(([k]) => k).join(', ') : 'none';
  process.stdout.write(`proto-to-doc: ${a.proto} → ${out} — ${sections.length} section(s), ${blocks.length} block(s)${names}, metadata: ${meta}${listed.length ? `; ${listed.length} image(s) unmapped` : ''}${written ? '' : ' (unchanged)'}\n`);
}
