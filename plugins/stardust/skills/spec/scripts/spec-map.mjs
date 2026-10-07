#!/usr/bin/env node
/**
 * spec-map.mjs — S7 block mapping: apply the agent's mapping rules (judgement/mapping.json) to every page's
 * component tree → ordered EDS block instances per page. Reports components the rules do not cover.
 *
 *   node spec-map.mjs [--config spec.config.json] [--rules <mapping.json>] [--in <components.jsonl>] [--out <jsonl>]
 *
 * Rules (reference/judgement.md): direct { component: { kind, block, variant?, keepEmpty? } } with kind
 * block|dynamic|default|metadata|drop (options: dropIfEmpty — default true for default/metadata only; keepEmpty;
 * whenKids — map only when the wrapper has non-empty children); layout [components flattened into their children]; sections
 * { component: { block, modsMatch } } (a styled wrapper → section-style row + its children); nesting
 * { component: block } (tabs/accordion: children become nested_in rows); carousels { component: { single, multi } };
 * rows { cards, columns, video, form: [components that dominate a row] }. Default-content runs merge into one row.
 * Output rows: { url, final_url, template, blocks: [{ pos, kind, block, variant, aem[], path, nested_in?, section? }] };
 * stderr lists unmapped components (kind "unmapped") with instance counts — iterate until it is empty.
 */
import { arg, helpAndExit, loadConfig, log, readJSON, readJSONL, writeText } from './lib.mjs';

helpAndExit(import.meta.url);

/** Column ratio label: equal | narrow-wide | wide-narrow (grid widths), or the column-control name. Pure. */
export function ratioLabel(n) {
  if (!n.widths) return n.c.split(':')[1] || String(n.ncols || '');
  const w = n.widths; if (w.every((x) => x === w[0])) return 'equal';
  if (w.length === 2) return w[0] < w[1] ? 'narrow-wide' : 'wide-narrow';
  return 'mixed-widths';
}
const empty = (n) => !n.chars && !n.imgs && !n.videos && !n.forms && !n.links && !(n.kids && n.kids.length) && !(n.cols && n.cols.length);

/** Map one page's component tree with the rules. Pure. */
export function mapPage(comps, R) {
  const direct = R.direct || {}; const layout = new Set(R.layout || []); const sections = R.sections || {};
  const nesting = R.nesting || {}; const carousels = R.carousels || {}; const rowsR = R.rows || {};
  const formSet = new Set(rowsR.form || []);
  const kindOf = (c) => direct[c]?.kind; const blockOf = (c) => direct[c]?.block;
  const isMedia = (c) => kindOf(c) === 'default' && /^(image|video)$/.test(blockOf(c) || '') || kindOf(c) === 'block' && blockOf(c) === (rowsR.video || 'video');
  const isText = (c) => kindOf(c) === 'default' && !/^(image|video|separator)$/.test(blockOf(c) || '');
  const inst = (kind, block, variant, n, ctx) => ({ kind, block, variant: variant ?? null, aem: [n.c], path: n.p, ...(ctx.nested_in ? { nested_in: ctx.nested_in } : {}), ...(ctx.section ? { section: ctx.section } : {}) });
  const mapNodes = (nodes, ctx) => nodes.flatMap((n) => mapNode(n, ctx));

  function mapRow(n, ctx) {
    const cols = (n.cols || []).filter((c) => c.length);
    if (cols.length <= 1) return mapNodes(cols[0] || [], ctx);
    // a column holding a wrapper: unwrap one level so shapes see the real content
    const flatCol = (col) => col.flatMap((k) => (layout.has(k.c) ? [...(k.kids || []), ...((k.cols || []).flat())] : [k]));
    const fcols = cols.map(flatCol);
    const kinds = fcols.flat().map((k) => k.c);
    if (kinds.some((c) => formSet.has(c))) {
      const formC = kinds.find((c) => formSet.has(c));
      const aside = fcols.flat().some((k) => !formSet.has(k.c) && !empty(k));
      return [inst(kindOf(formC) || 'block', blockOf(formC) || formC, aside ? 'with-aside' : null, n, ctx)];
    }
    const shape = fcols.map((col) => ({ media: col.some((k) => isMedia(k.c)), video: col.some((k) => blockOf(k.c) === 'video' || /video/.test(k.c)), text: col.some((k) => isText(k.c)), other: col.some((k) => !isMedia(k.c) && !isText(k.c) && !empty(k) && !layout.has(k.c)) }));
    if (shape.some((s) => s.other)) return mapNodes(fcols.flat(), ctx); // real blocks inside: the row is layout only
    const filled = fcols.filter((col) => col.some((k) => !empty(k)));
    if (filled.length <= 1) return mapNodes(fcols.flat(), ctx);
    const N = fcols.length; const withMedia = shape.filter((s) => s.media || s.video);
    const ratio = ratioLabel(n);
    if (N >= 3) {
      if (withMedia.length >= 2) return [inst('block', rowsR.cards || 'cards', withMedia.every((s) => s.video && !s.media) ? 'video-grid' : `${N}-up${shape.some((s) => s.text) ? '' : '-image-only'}`, n, ctx)];
      return [inst('block', rowsR.columns || 'columns', `text-${N}`, n, ctx)];
    }
    const [a, b] = shape;
    if ((a.media && a.text) && (b.media && b.text)) return [inst('block', rowsR.cards || 'cards', '2-up', n, ctx)];
    if ((a.media || a.video) && !a.text && b.text && !(b.media || b.video)) return [inst('block', rowsR.columns || 'columns', `${a.video ? 'video' : 'image'}-text ${ratio}`, n, ctx)];
    if ((b.media || b.video) && !b.text && a.text && !(a.media || a.video)) return [inst('block', rowsR.columns || 'columns', `text-${b.video ? 'video' : 'image'} ${ratio}`, n, ctx)];
    if (a.text && b.text && !a.media && !b.media) return [inst('block', rowsR.columns || 'columns', `text ${ratio}`, n, ctx)];
    if ((a.media || a.video) && (b.media || b.video) && !a.text && !b.text) return [inst('block', rowsR.columns || 'columns', 'media-pair', n, ctx)];
    return [inst('block', rowsR.columns || 'columns', `mixed ${ratio}`, n, ctx)];
  }

  function mapNode(n, ctx) {
    const c = n.c;
    if (c === 'row' || c.startsWith('colctrl')) return mapRow(n, ctx);
    if (sections[c] && (n.mods || []).some((m) => new RegExp(sections[c].modsMatch || '.').test(m))) {
      const style = (n.mods || []).find((m) => new RegExp(sections[c].modsMatch || '.').test(m));
      const kids = [...(n.kids || []), ...((n.cols || []).flat())];
      return [inst('section', sections[c].block || 'section-style', style, n, ctx), ...mapNodes(kids, { ...ctx, section: style })];
    }
    if (layout.has(c)) return [...mapNodes(n.kids || [], ctx), ...((n.cols || []).flatMap((col) => mapNodes(col, ctx)))];
    if (carousels[c]) {
      const r = (n.slides || 0) >= 2 ? carousels[c].multi : carousels[c].single;
      return r ? [inst(r.kind || 'block', r.block, r.variant, n, ctx)] : [];
    }
    if (nesting[c]) {
      const nested = mapNodes(n.kids || [], { ...ctx, nested_in: nesting[c] }).filter((x) => x.kind === 'block' || x.kind === 'dynamic');
      return [inst('block', nesting[c], nested.length ? 'with-nested-blocks' : null, n, ctx), ...nested];
    }
    const d = direct[c];
    if (d) {
      if (d.kind === 'drop') return [];
      if (d.whenKids && !(n.kids || []).some((k) => (k.kids || []).length || !empty(k))) return [];
      // empty default/metadata is authoring noise; empty blocks stay unless the rule says dropIfEmpty
      const dropEmpty = d.dropIfEmpty ?? (d.kind === 'default' || d.kind === 'metadata');
      if (empty(n) && dropEmpty && !d.keepEmpty) return [];
      return [inst(d.kind, d.block || c, d.variant, n, ctx)];
    }
    return [inst('unmapped', c, null, n, ctx)];
  }

  const out = [];
  for (const it of mapNodes(comps, {})) {
    const prev = out[out.length - 1];
    if (it.kind === 'default' && prev && prev.kind === 'default' && prev.nested_in === it.nested_in && prev.section === it.section) {
      it.aem.forEach((a) => { if (!prev.aem.includes(a)) prev.aem.push(a); });
      if (!prev.parts.includes(it.block)) prev.parts.push(it.block);
      continue;
    }
    out.push(it.kind === 'default' ? { ...it, parts: [it.block] } : it);
  }
  return out.map((it, pos) => (it.kind === 'default' ? { ...it, block: 'default-content', variant: it.parts.join('+'), parts: undefined, pos } : { ...it, pos }));
}

function main() {
  const cfg = loadConfig();
  const rules = readJSON(arg('rules', cfg.p('judgement', 'mapping.json')));
  const rows = readJSONL(arg('in', cfg.p('parse', 'components.jsonl')));
  const unmapped = {}; const lines = [];
  for (const r of rows) {
    const blocks = mapPage(r.comps, rules);
    blocks.filter((b) => b.kind === 'unmapped').forEach((b) => { unmapped[b.block] = (unmapped[b.block] || 0) + 1; });
    lines.push(JSON.stringify({ url: r.url, final_url: r.final_url, template: r.template, blocks }));
  }
  writeText(arg('out', cfg.p('judgement', 'page-blocks.jsonl')), lines.join('\n'));
  const u = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
  log(`${rows.length} pages mapped; unmapped components: ${u.length ? u.map(([k, v]) => `${k}:${v}`).join(', ') : 'none'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
