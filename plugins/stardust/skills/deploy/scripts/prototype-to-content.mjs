#!/usr/bin/env node
/**
 * skills/deploy/scripts/prototype-to-content.mjs — prototype → DA body-fragment transcriber (Step 9).
 *
 * Emits `content/<path>.html` FROM a gated prototype (or a Path-B migrated render) and its
 * section schema, so no project writes a one-off generator. Four field projects rewrote one
 * each; the recurring defects were a silent flatten of a bespoke section, a generator that
 * overwrote hand edits, and a `breadcrumbs` block authored per page. Contract:
 * `reference/content-page-scaffold.md` § Generator contract.
 *
 *   node skills/deploy/scripts/prototype-to-content.mjs <prototype.html|migrated/index.html|URL>
 *        --out content/<path>.html [--schema stardust/eds-schema/<page>.json] [--thin]
 *        [--map <section>=block:<name>|default|drop:<reason>]* [--drop <selector>]*
 *        [--slug <slug>] [--ledger stardust/.work/deploy/transcribe.json] [--patches stardust/patches]
 *        [--render] [--width 1280] [--dry-run] [--force] [--json] [--help]
 *
 * Input: a local file is parsed as served (no browser — a static prototype's DOM is its markup);
 * an http(s) URL, or `--render`, renders through Playwright (resolution chain) and transcribes the
 * settled `<main>`. Zero requests to the source site either way. `script/style/noscript/template`
 * and non-authorable elements (form, iframe, video, svg, button, …) are dropped and recorded.
 *
 * Section → emitter (no heuristics: the schema decides, `--map` overrides):
 *   `--map <section>=…`                 explicit — block:<name>, default, or drop:<reason> (recorded)
 *   schema section with `repeats[]`     block named after the section, ONE row per repeat unit
 *                                       (media cell, then text cell); prose before/after the units
 *                                       stays default content in the same section
 *   schema section, no repeats, prose   default content (headings, p, lists, table → `table` block,
 *   tags only                           CTAs as <p><strong><a>> / <em><a>>)
 *   anything else                       UNMAPPED → exit 2, nothing written
 *   `--thin`                            no schema: every section is default content; a duplicate
 *                                       <h1> is demoted to <h2>, a link list before the first <h1>
 *                                       is dropped as `breadcrumb-trail → runtime` (never a
 *                                       `breadcrumbs` block — the runtime builds it from the URL),
 *                                       twins (same text as a sibling) and empty shells are dropped;
 *                                       site-specific vehicles arrive by `--drop <selector>`.
 * Every drop, demotion and unmapped section is one `dropped:` / `unmapped:` line and a ledger entry.
 * The metadata block (Title from the <h1>, Description from the first ≥ 40-char paragraph) rides in
 * the first content section. Links are root-relative without `.html` (D9); image `src` verbatim.
 *
 * Idempotent writer (migrate/SKILL.md generator rules): `stardust/patches/<slug>.json`
 * ([{selector, op: replace|attr|remove, name?, value?}]) is applied LAST; the output is sanitised
 * in place (`sanitise.js`); the ledger records `{ sections[], blocks[], dropped[], unmapped[], sha,
 * script, path }` per page, keyed by the output path relative to the project root (absolute outside
 * it) — `content/x.html`, `./content/x.html` and `../content/x.html` from a sub-directory are ONE row.
 * An existing output whose sha is not the ledger's is a hand edit → exit 2 (move the edit into the
 * patch file, or `--force`). Same inputs → byte-identical output.
 *
 * Exit codes:
 *   0  written (or --dry-run with nothing blocking)        stdout: one line per section, `written <out>`
 *   1  usage · input, schema or patch file unreadable · sanitise failed
 *   2  blocked, nothing written: 0 sections · no <h1> · unmapped section(s) · hand-edited output ·
 *      Playwright unresolvable (the resolution chain's own exit 2 — no verdict, run the preflight)
 * Never: publishes, previews, PUTs, contacts the source site, edits `davids-model-lint` tiers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveDep, siblingScript, exit2 } from '../../stardust/scripts/lib/resolve.mjs';

const dom = await import(pathToFileURL(siblingScript('migrate', 'importer-skeleton.mjs', { from: import.meta.url })).href);
const { parseHTML, qs, qsa, kids, attr, cleanText, walk, applyPatches, esc } = dom;
const remove = (n) => { dom.remove(n); n.parent = null; }; // detached nodes must read as detached (the importer's remove keeps `parent`)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = 'skills/deploy/scripts/prototype-to-content.mjs';
const STRIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'svg', 'canvas', 'object', 'embed']);
const NON_AUTHORABLE = new Set(['form', 'input', 'button', 'select', 'textarea', 'iframe', 'video', 'audio', 'dialog', 'nav']);
const PROSE = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'u', 'sup', 'sub', 'code', 'br', 'img', 'picture', 'source', 'span', 'small', 'time', 'abbr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'blockquote', 'pre', 'figure', 'figcaption', 'hr', 'dl', 'dt', 'dd', 'image-slot']);
const WRAPPER = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'figure', 'span', 'small', 'time', 'abbr', 'label']);
const BLOCKISH = /^(h[1-6]|p|ul|ol|table|blockquote|pre|dl|div|picture|img|hr)$/;
const LIST_LIKE = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'picture']);
const KEEP = { a: ['href', 'title'], img: ['src', 'srcset', 'alt', 'width', 'height'], source: ['src', 'srcset', 'media', 'type'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] };
const CTA = /(^|\s|-)(btn|button|cta)(\s|-|$)/;
const SECONDARY = /(^|\s|-)(secondary|outline|ghost|tertiary|link)(\s|-|$)/;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function parseArgs(argv) {
  const a = { input: null, out: null, schema: null, thin: false, map: {}, drop: [], slug: null, ledger: path.join('stardust', '.work', 'deploy', 'transcribe.json'), patches: path.join('stardust', 'patches'), render: false, width: 1280, dryRun: false, force: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const need = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--out') a.out = need();
    else if (k === '--schema') a.schema = need();
    else if (k === '--thin') a.thin = true;
    else if (k === '--map') { const v = need(); const m = v.match(/^([^=]+)=(block:[a-z0-9][a-z0-9-]*|default|drop:.+)$/); if (!m) throw new Error(`--map ${v}: use <section>=block:<name>|default|drop:<reason>`); a.map[m[1]] = m[2]; }
    else if (k === '--drop') a.drop.push(need());
    else if (k === '--slug') a.slug = need();
    else if (k === '--ledger') a.ledger = need();
    else if (k === '--patches') a.patches = need();
    else if (k === '--render') a.render = true;
    else if (k === '--width') { a.width = Number(need()); if (!Number.isInteger(a.width) || a.width < 320) throw new Error('--width needs an integer ≥ 320'); }
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--force') a.force = true;
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k.startsWith('--')) throw new Error(`unknown arg: ${k}`);
    else if (!a.input) a.input = k;
    else throw new Error(`unexpected argument: ${k}`);
  }
  return a;
}

// ───────────────────────────────────────────────────────────── DOM helpers ──
const classList = (n) => String(attr(n, 'class') || '').split(/\s+/).filter(Boolean);
const describe = (n) => `${n.tag}${attr(n, 'id') ? `#${attr(n, 'id')}` : ''}${classList(n).slice(0, 2).map((c) => `.${c}`).join('')}`;
const hasMedia = (n) => qs(n, 'img, picture') !== null;
const visible = (n) => cleanText(n).length > 0 || hasMedia(n);
const isAnc = (a, n) => { for (let p = n.parent; p; p = p.parent) if (p === a) return true; return false; };

/** Top-level prototype sections of <main> in document order, named like section-schema.mjs (ordinals on repeats). */
export function topSections(root) {
  const main = qs(root, 'main') || root;
  const all = qsa(main, 'section, [data-section]');
  const top = all.filter((s) => !all.some((o) => o !== s && isAnc(o, s)));
  const list = top.length ? top : all.length ? all : kids(main).filter((k) => !STRIP.has(k.tag) && visible(k));
  const seen = {};
  return list.map((sec, idx) => {
    const base = attr(sec, 'data-section') || classList(sec)[0] || `section-${idx}`;
    seen[base] = (seen[base] || 0) + 1;
    return { idx, name: seen[base] > 1 ? `${base}-${seen[base]}` : base, el: sec };
  });
}

/** A section is prose-shaped when every element in it is a prose tag or a wrapper that does not split content into classed layout groups. */
export function proseShaped(sec) {
  const total = cleanText(sec);
  for (const n of walk(sec)) {
    if (STRIP.has(n.tag)) continue;
    if (NON_AUTHORABLE.has(n.tag)) return { ok: false, why: `<${n.tag}>` };
    if (PROSE.has(n.tag)) continue;
    if (!WRAPPER.has(n.tag)) return { ok: false, why: `<${n.tag}>` };
    if (!classList(n).length || !visible(n) || cleanText(n) === total) continue; // structural or full-width container
    const sibs = kids(n.parent).filter((s) => s !== n && WRAPPER.has(s.tag) && classList(s).length && visible(s));
    if (sibs.length) return { ok: false, why: `layout wrappers ${describe(n)} + ${describe(sibs[0])}` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────── rich text ──
export function richText(node, ctx) {
  const clean = (n) => {
    if (n.type === 'text') { if (n.parent && LIST_LIKE.has(n.parent.tag) && !/\S/.test(n.text)) return ''; return n.text.replace(/&(?![a-zA-Z#]\w*;)/g, '&amp;').replace(/</g, '&lt;'); }
    if (n.type !== 'element' || STRIP.has(n.tag)) return '';
    if (NON_AUTHORABLE.has(n.tag)) { ctx.dropped.push({ what: describe(n), reason: 'non-authorable' }); return ''; }
    if (n.tag === 'image-slot') { ctx.dropped.push({ what: 'image-slot', reason: 'placeholder → empty cell' }); return ''; }
    if (n.tag === 'hr') return '';
    let tag = n.tag;
    if (tag === 'b') tag = 'strong'; else if (tag === 'i') tag = 'em'; else if (tag === 'figcaption' || tag === 'dd') tag = 'p'; else if (tag === 'dt') return `<p><strong>${n.children.map(clean).join('')}</strong></p>`;
    if (WRAPPER.has(tag)) {
      if (tag === 'span' && !n.children.some((c) => c.type === 'element')) return n.children.map(clean).join('');
      const chunks = []; let run = '';
      for (const c of n.children) {
        if (c.type === 'element' && (BLOCKISH.test(c.tag) || WRAPPER.has(c.tag) && c.children.some((x) => x.type === 'element' && BLOCKISH.test(x.tag)))) { if (run.trim()) chunks.push(`<p>${run.trim()}</p>`); run = ''; chunks.push(clean(c)); }
        else run += clean(c);
      }
      if (run.trim()) chunks.push(`<p>${run.trim()}</p>`);
      return chunks.filter(Boolean).join('\n');
    }
    if (/^h[1-6]$/.test(tag) && !cleanText(n) && !hasMedia(n)) return '';
    if (tag === 'p' && !cleanText(n) && !hasMedia(n) && !qs(n, 'a[href]')) return '';
    if (tag === 'table') return tableBlock(n, ctx);
    const attrs = {};
    for (const k of KEEP[tag] || []) if (n.attrs[k] !== undefined) attrs[k] = n.attrs[k];
    if (tag === 'a') {
      const h = String(attrs.href || '').trim();
      if (!h || h === '#' || /^javascript:/i.test(h)) { return n.children.map(clean).join(''); }
      attrs.href = ctx.link(h);
    }
    if (tag === 'img' && attrs.alt === undefined) attrs.alt = '';
    const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    if (tag === 'img' || tag === 'source' || tag === 'br') return `<${tag}${a}>`;
    let inner = n.children.map(clean).join('');
    if (tag === 'a' && attrs.href && CTA.test(classList(n).join(' '))) {
      const emph = SECONDARY.test(classList(n).join(' ')) ? 'em' : 'strong';
      const link = `<${emph}><a${a}>${inner}</a></${emph}>`;
      return n.parent && n.parent.tag === 'p' ? link : `<p>${link}</p>`;
    }
    if (tag === 'p' && n.children.length === 1 && n.children[0].type === 'element' && n.children[0].tag === 'a' && CTA.test(classList(n.children[0]).join(' '))) return clean(n.children[0]).startsWith('<p>') ? clean(n.children[0]) : `<p>${clean(n.children[0])}</p>`;
    inner = inner.trim();
    if (!inner && tag !== 'td' && tag !== 'th') return '';
    return `<${tag}${a}>${inner}</${tag}>`;
  };
  const html = clean(node).trim();
  if (!html) return '';
  return /^<(h[1-6]|p|ul|ol|div|blockquote|pre|img|picture|table)/.test(html) ? html : `<p>${html}</p>`;
}

/** Raw <table> → the `table` block (one row per <tr>, one cell per <td>/<th>); the TABLE lint 🔴 names this shape. */
function tableBlock(table, ctx) {
  const inner = (c) => richText({ type: 'element', tag: 'div', attrs: {}, children: c.children, parent: null }, ctx) || '';
  const rows = qsa(table, 'tr').map((tr) => kids(tr).filter((c) => c.tag === 'td' || c.tag === 'th').map(inner));
  if (!rows.length) return '';
  ctx.blocks.push('table');
  return renderBlock({ name: 'table', rows: rows.map((r) => r.map((c) => c.replace(/^<p>([\s\S]*)<\/p>$/, '$1'))) });
}

const cell = (c) => `      <div>${c}</div>`;
export const renderBlock = (b) => `    <div class="${b.name}">\n${b.rows.map((r) => `    <div>\n${r.map(cell).join('\n')}\n    </div>`).join('\n')}\n    </div>`;
const renderSection = (parts) => `  <div>\n${parts.map((p) => p.split('\n').map((l) => (l.startsWith('    ') ? l : `    ${l}`)).join('\n')).join('\n')}\n  </div>`;

/** Root-relative, extensionless internal links (D9); external, mailto and tel kept. */
export function normaliseHref(h) {
  if (/^(https?:)?\/\//i.test(h) || /^(mailto|tel|sms):/i.test(h)) return h;
  if (h.startsWith('#')) return h;
  let p = h.replace(/^\.\//, '');
  if (!p.startsWith('/')) p = `/${p}`;
  const [pathPart, hash] = p.split('#');
  const [pn, q] = pathPart.split('?');
  let out = pn.replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return `${out || '/'}${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`;
}

// ───────────────────────────────────────────────────────── repeat-unit block ──
function unitContainer(sec, rep) {
  const [tag, cls] = String(rep.unitSelector).split('.');
  const keyOf = (k) => `${k.tag.toUpperCase()}.${classList(k)[0] || ''}`;
  for (const c of [sec, ...walk(sec)]) {
    const members = kids(c).filter((k) => keyOf(k) === `${tag}.${cls || ''}`);
    if (members.length >= 2) return { container: c, members };
  }
  return null;
}

function unitCells(unit, ctx) {
  const ks = kids(unit);
  const media = ks.find((k) => (k.tag === 'img' || k.tag === 'picture' || k.tag === 'figure' || (hasMedia(k) && !cleanText(k))));
  let rest = ks.filter((k) => k !== media);
  let link = '';
  if (unit.tag === 'a' && attr(unit, 'href')) {
    const label = rest.find((k) => !k.children.some((c) => c.type === 'element' && BLOCKISH.test(c.tag)) && cleanText(k) && !/^h[1-6]$/.test(k.tag) && k.tag !== 'p');
    const text = label ? cleanText(label) : cleanText(qs(unit, 'h1,h2,h3,h4,h5,h6') || rest[0] || unit);
    if (label) rest = rest.filter((k) => k !== label);
    link = `<p><a href="${esc(ctx.link(attr(unit, 'href')))}">${esc(text)}</a></p>`;
  }
  const text = [...rest.map((k) => richText(k, ctx)).filter(Boolean), link].filter(Boolean).join('\n');
  const cells = media ? [richText(media, ctx), text] : [text || richText(unit, ctx)];
  return cells;
}

function blockSection(name, sec, rep, ctx) {
  const hit = unitContainer(sec, rep);
  if (!hit) return null;
  const before = []; const after = []; let seenContainer = false;
  const visit = (n) => {
    for (const c of n.children) {
      if (c.type !== 'element') continue;
      if (c === hit.container) { seenContainer = true; continue; }
      if (isAnc(c, hit.container)) { visit(c); continue; }
      const html = richText(c, ctx); if (!html) continue;
      (seenContainer ? after : before).push(html);
    }
  };
  visit(sec);
  const rows = hit.members.filter(visible).map((u) => unitCells(u, ctx));
  ctx.blocks.push(name);
  return { parts: [...before, renderBlock({ name, rows }), ...after], rows: rows.length };
}

// ────────────────────────────────────────────────────────────── thin mode ──
function thinPrepare(root, ctx) {
  const main = qs(root, 'main') || root;
  const h1s = qsa(main, 'h1');
  if (h1s.length > 1) {
    const hidden = h1s.filter((h) => /(^|\s)(sr-only|visually-hidden|screen-reader-text)(\s|$)/.test(attr(h, 'class') || ''));
    for (const h of hidden) { if (h1s.length - hidden.length >= 1) { ctx.dropped.push({ what: `h1 "${cleanText(h).slice(0, 40)}"`, reason: 'hidden duplicate <h1>' }); remove(h); } }
    for (const h of qsa(main, 'h1').slice(1)) { ctx.dropped.push({ what: `h1 "${cleanText(h).slice(0, 40)}"`, reason: 'demoted to <h2>' }); h.tag = 'h2'; }
  }
  const h1 = qs(main, 'h1');
  for (const list of qsa(main, 'ul, ol, nav')) {
    if (!attached(list) || (h1 && !precedes(list, h1))) continue;
    const items = list.tag === 'nav' ? qsa(list, 'a') : kids(list).filter((k) => k.tag === 'li');
    if (items.length && items.every((li) => qs(li, 'a[href]') || li.tag === 'a' || cleanText(li).length < 40) && qsa(list, 'a[href]').length >= 1 && (h1 ? precedes(list, h1) : true)) {
      ctx.dropped.push({ what: describe(list), reason: 'breadcrumb-trail → runtime' }); remove(list);
    }
  }
  for (const sec of topSections(root)) {
    const seen = new Set();
    for (const k of kids(sec.el)) {
      const t = cleanText(k);
      if (!t) { if (classList(k).length && !hasMedia(k)) { ctx.dropped.push({ what: describe(k), reason: 'empty shell' }); remove(k); } continue; }
      if (seen.has(t)) { ctx.dropped.push({ what: describe(k), reason: 'twin (same text as a sibling)' }); remove(k); continue; }
      seen.add(t);
    }
  }
}
const attached = (n) => { let x = n; while (x.parent) x = x.parent; return x.type === 'root'; };
function precedes(a, b) { // document order: a before b (neither contains the other)
  const order = (n) => { const p = []; for (let x = n; x && x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x)); return p; };
  const pa = order(a); const pb = order(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return pa.length < pb.length;
}

// ──────────────────────────────────────────────────────────────── transcribe ──
/** Pure core: html + options → { html, record } or { blocked: [reasons], record }. */
export function transcribe(html, { schema = null, thin = false, map = {}, drop = [] } = {}) {
  const root = parseHTML(html);
  const record = { sections: [], blocks: [], dropped: [], unmapped: [], warnings: [] };
  const ctx = { dropped: record.dropped, blocks: record.blocks, link: normaliseHref };
  for (const n of [...walk(root)].filter((x) => STRIP.has(x.tag))) remove(n);
  for (const sel of drop) for (const n of qsa(root, sel)) { record.dropped.push({ what: describe(n), reason: `--drop ${sel}` }); remove(n); }
  if (thin) thinPrepare(root, ctx);
  const secs = topSections(root).filter((s) => visible(s.el));
  const blocked = [];
  if (!secs.length) blocked.push('0 sections');
  const sectionsOut = [];
  for (const s of secs) {
    const explicit = map[s.name];
    const schemaSec = schema ? (schema.sections || []).find((x) => x.section === s.name) || null : null; // by NAME only — never paired by position
    let emitter; let parts = []; let rows = 0;
    if (explicit && explicit.startsWith('drop:')) { emitter = explicit; record.dropped.push({ what: s.name, reason: explicit.slice(5) }); record.sections.push({ name: s.name, emitter, rows: 0 }); continue; }
    if (explicit && explicit.startsWith('block:')) {
      emitter = explicit;
      const name = explicit.slice(6);
      const rep = schemaSec && schemaSec.repeats && schemaSec.repeats[0];
      const b = rep ? blockSection(name, s.el, rep, ctx) : null;
      if (b) { parts = b.parts; rows = b.rows; } else { // no repeat units: the whole section is ONE row, its top-level groups the cells
        const cells = kids(s.el).filter(visible).map((k) => richText(k, ctx)).filter(Boolean);
        ctx.blocks.push(name); rows = 1; parts = [renderBlock({ name, rows: [cells.length ? cells : [richText(s.el, ctx)]] })];
      }
    } else if (explicit === 'default' || thin) {
      emitter = 'default'; parts = [richText(s.el, ctx)].filter(Boolean);
    } else if (!schema) {
      blocked.push('no schema (pass --schema, or --thin for default content)'); break;
    } else if (!schemaSec) {
      const at = (schema.sections || [])[s.idx];
      emitter = 'unmapped'; record.unmapped.push({ section: s.name, why: at ? `not in the schema (its position holds "${at.section}" — names differ, nothing is paired by position)` : 'not in the schema' });
    } else if (schemaSec.repeats && schemaSec.repeats.length) {
      emitter = `block:${s.name}`;
      const b = blockSection(s.name, s.el, schemaSec.repeats[0], ctx);
      if (b) { parts = b.parts; rows = b.rows; } else { emitter = 'unmapped'; record.unmapped.push({ section: s.name, why: `repeat unit ${schemaSec.repeats[0].unitSelector} not found` }); }
    } else {
      const shape = proseShaped(s.el);
      if (shape.ok) { emitter = 'default'; parts = [richText(s.el, ctx)].filter(Boolean); } else { emitter = 'unmapped'; record.unmapped.push({ section: s.name, why: shape.why }); }
    }
    if (schemaSec && schemaSec.style) parts.push(renderBlock({ name: 'section-metadata', rows: [['style', esc(String(schemaSec.style))]] }));
    record.sections.push({ name: s.name, emitter, rows });
    if (emitter !== 'unmapped' && parts.length) sectionsOut.push(parts);
  }
  if (record.unmapped.length) blocked.push(`unmapped: ${record.unmapped.map((u) => `${u.section} (${u.why})`).join(', ')}`);
  const bodyDoc = parseHTML(sectionsOut.flat().join('\n'));
  const h1 = qs(bodyDoc, 'h1');
  if (!h1 || !(cleanText(h1) || hasMedia(h1))) blocked.push('no <h1>');
  if (schema) { // ENCODE assertion: every schema item text appears in the output (an absent item is a drop you chose)
    const outText = cleanText(bodyDoc).toLowerCase();
    for (const sec of schema.sections || []) for (const it of sec.items || []) { const t = String(it.text || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (t && !outText.includes(t)) record.warnings.push(`encode item missing: "${t.slice(0, 60)}" (${sec.section})`); }
  }
  if (blocked.length) return { blocked, record };
  const title = cleanText(h1);
  const desc = qsa(bodyDoc, 'p').map(cleanText).find((t) => t.length >= 40 && !/^(open|start|compare|learn|read|get)\b/i.test(t)) || '';
  const description = desc.length > 160 ? `${desc.slice(0, 157).replace(/\s+\S*$/, '')}…` : desc;
  const meta = renderBlock({ name: 'metadata', rows: [['Title', esc(title)], ...(description ? [['Description', esc(description)]] : [])] });
  sectionsOut[0].unshift(meta);
  record.blocks = [...new Set(record.blocks)];
  const out = `<body>\n  <header></header>\n  <main>\n${sectionsOut.map(renderSection).join('\n')}\n  </main>\n  <footer></footer>\n</body>\n`;
  return { html: out, record };
}

// ─────────────────────────────────────────────────────────────────── render ──
async function renderMain(input, width) {
  const pw = await resolveDep('playwright', { from: import.meta.url, script: 'prototype-to-content.mjs' }).catch(exit2);
  const chromium = pw.chromium || (pw.default && pw.default.chromium); // a CJS entry reached by file URL exposes `default` (+ `module.exports` on Node ≥ 22)
  const url = /^https?:\/\//.test(input) ? input : pathToFileURL(path.resolve(input)).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(800);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 30); }); } window.scrollTo(0, 0); });
    const main = await page.evaluate(() => (document.querySelector('main') || document.body).outerHTML);
    return `<html><body>${main}</body></html>`;
  } finally { await browser.close(); }
}

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Error(`${p}: ${e.message}`); } };
/** Ledger key: the output path relative to the project root (cwd), absolute when it lies outside — `./x` and `x` are one row. */
const ledgerKey = (out) => { const abs = path.resolve(out); const rel = path.relative(process.cwd(), abs); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs; };
const slugOf = (out, given) => given || (path.basename(out, '.html') === 'index' ? path.basename(path.dirname(path.resolve(out))) : path.basename(out, '.html'));

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`prototype-to-content: ${e.message}`); return 1; }
  if (a.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim()); return 0; }
  if (!a.input || !a.out) { console.error('usage: node skills/deploy/scripts/prototype-to-content.mjs <prototype|URL> --out content/<path>.html (--schema <json> | --thin) [--map …] [--drop …] [--dry-run] [--force] [--help]'); return 1; }
  let html; let schema = null;
  try {
    html = (a.render || /^https?:\/\//.test(a.input)) ? await renderMain(a.input, a.width) : readFileSync(a.input, 'utf8');
    if (a.schema) schema = readJSON(a.schema);
  } catch (e) { console.error(`prototype-to-content: ${e.message}`); return 1; }
  const res = transcribe(html, { schema, thin: a.thin, map: a.map, drop: a.drop });
  for (const s of res.record.sections) console.log(`  ${s.name.padEnd(24)} ${s.emitter}${s.rows ? ` rows=${s.rows}` : ''}`);
  for (const d of res.record.dropped) console.log(`  dropped: ${d.what} → ${d.reason}`);
  for (const w of res.record.warnings) console.log(`  warning: ${w}`);
  if (res.blocked) {
    for (const u of res.record.unmapped) console.log(`  unmapped: ${u.section} on ${a.out} (${u.why}) — --map ${u.section}=block:<name>|default|drop:<reason>`);
    console.log(`blocked: ${res.blocked.join(' · ')} — nothing written`);
    if (a.json) console.log(JSON.stringify({ out: a.out, blocked: res.blocked, ...res.record }));
    return 2;
  }
  let out = res.html; const slug = slugOf(a.out, a.slug);
  const patchFile = path.join(a.patches, `${slug}.json`);
  if (existsSync(patchFile)) {
    let patches; try { patches = readJSON(patchFile); } catch (e) { console.error(`prototype-to-content: ${e.message}`); return 1; }
    const p = applyPatches(out, patches); out = p.html; res.record.patchesApplied = p.applied;
    console.log(`  patches: ${patchFile} (${p.applied.length} op${p.applied.length === 1 ? '' : 's'})`);
  }
  const ledger = existsSync(a.ledger) ? readJSON(a.ledger) : { _provenance: { writtenBy: 'stardust:deploy/prototype-to-content' }, pages: {} };
  const outAbs = path.resolve(a.out);
  const key = Object.keys(ledger.pages).find((k) => k === ledgerKey(a.out) || (ledger.pages[k] && ledger.pages[k].path === outAbs)) || ledgerKey(a.out);
  const row = ledger.pages[key];
  if (existsSync(a.out) && !a.force && !a.dryRun) {
    const onDisk = sha256(readFileSync(a.out));
    if (!row || row.sha !== onDisk) { console.log(`blocked: hand-edited output ${a.out} (${row ? 'sha differs from the last generated one' : 'no ledger row — not generated by this script'}) — move the edit into ${patchFile} or pass --force; nothing written`); return 2; }
  }
  if (a.dryRun) { console.log(`dry-run: ${a.out} not written (${res.record.sections.length} sections, blocks: ${res.record.blocks.join(', ') || '-'})`); if (a.json) console.log(JSON.stringify({ out: a.out, dryRun: true, ...res.record })); return 0; }
  mkdirSync(path.dirname(a.out), { recursive: true });
  writeFileSync(a.out, out);
  const san = spawnSync(process.execPath, [path.join(HERE, 'sanitise.js'), a.out], { encoding: 'utf8' });
  if (san.status !== 0) { console.error(`prototype-to-content: sanitise failed: ${san.stderr}`); return 1; }
  const sha = sha256(readFileSync(a.out));
  ledger.pages[key] = { input: a.input, slug, path: outAbs, ...res.record, sha, script: SCRIPT, at: new Date().toISOString() };
  mkdirSync(path.dirname(a.ledger), { recursive: true });
  writeFileSync(a.ledger, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`written ${a.out} (${res.record.sections.length} sections, blocks: ${res.record.blocks.join(', ') || '-'}, ${res.record.dropped.length} dropped) — next: node skills/deploy/scripts/davids-model-lint.mjs ${a.out}`);
  if (a.json) console.log(JSON.stringify({ out: a.out, key, ...ledger.pages[key] }));
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((c) => process.exit(c)).catch((e) => { console.error(`prototype-to-content: ${e.message}`); process.exit(1); });
