// skills/reskin/scripts/figma/renders.mjs — figma-donor.mjs renders (reskin Phase 2′, Figma-only sites;
// reference/gates.md § (f) Exact fidelity). The references the exact and library gates compare against,
// fetched once so the gates run offline:
//   pages    every breakpoint frame of every page in figma-pages.json (desktop, tablet, mobile)
//   library  every variant of every public set (or lone public component) of every kit block, used on a
//            page or not, with its variant classes and its copy (visible TEXT, reading order)
// PNGs at --scale (default 1) under <cache root>/_pages/<version>/png/; reskin/figma-renders.json indexes
// them. renderTargets and textsOf are pure.
import { mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { safeId } from './content.mjs';
import { compileKit, parseVariant, setClass, variantClasses } from './pages.mjs';
import { cacheFor } from './cache.mjs';
import { readJsonIf, writeFileAtomic, writeJson } from './io.mjs';
import { UsageError } from './errors.mjs';
import { parseFigmaUrl } from './url.mjs';
import { pagesFile } from './pages-run.mjs';

export const rendersFile = (dir) => join(dir, 'reskin', 'figma-renders.json');
export const RENDERS_VERSION = 1;
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const visible = (n) => n && n.visible !== false;
const box = (n) => n?.absoluteBoundingBox || null;

// Visible text of a node in reading order (rows by top, then left), characters as drawn.
export function textsOf(node) {
  const out = [];
  (function walk(n) {
    if (!visible(n)) return;
    if (n.type === 'TEXT' && String(n.characters || '').trim()) out.push({ t: n.characters, b: box(n) || { x: 0, y: 0 } });
    for (const c of n.children || []) walk(c);
  }(node));
  return out.sort((a, b) => (Math.abs(a.b.y - b.b.y) > 4 ? a.b.y - b.b.y : a.b.x - b.b.x)).map((x) => x.t);
}

// pages: [{ slug, breakpoint, id }]; library: [{ block, module, set, setId, setClass, id, name, classes, breakpoint }]
// from the manifest and the full documents of each block's public sets (setDocs: { setId: document }).
export function renderTargets(manifest, setDocs, kit = compileKit({})) {
  const pages = [];
  for (const p of manifest.pages || []) for (const [bp, v] of Object.entries(p.variants || {})) if (v?.id) pages.push({ slug: p.slug, breakpoint: bp, id: v.id });
  if (!pages.length) for (const p of manifest.pages || []) pages.push({ slug: p.slug, breakpoint: 'desktop', id: p.frame });
  const library = [];
  const missing = [];
  for (const b of manifest.kit?.blocks || []) {
    for (const s of b.sets?.length ? b.sets : [b.set]) {
      const doc = setDocs[s.id];
      if (!doc) { missing.push({ block: b.block, set: s.name, id: s.id }); continue; }
      const comps = doc.type === 'COMPONENT_SET' ? (doc.children || []).filter((c) => c.type === 'COMPONENT' && visible(c)) : [doc];
      const cls = s.class ?? null;
      for (const c of comps) {
        const props = doc.type === 'COMPONENT_SET' ? parseVariant(c.name) || [] : [];
        const bpProp = props.find(([k]) => kit.breakpointProp.test(k));
        library.push({
          block: b.block, module: b.module, used: Boolean(b.used), set: s.name, setId: s.id, setClass: cls, id: c.id, name: c.name,
          classes: [...(cls ? [cls] : []), ...variantClasses(props, kit)], breakpoint: bpProp ? String(bpProp[1]).toLowerCase() : null,
          w: box(c)?.width ?? null, h: box(c)?.height ?? null, texts: textsOf(c),
        });
      }
    }
  }
  return { pages, library, missing };
}

export async function runRenders({ dir, url, client, at, scale = 1, refresh = false, only = null, warn = () => {} }) {
  const manifest = readJsonIf(pagesFile(dir));
  if (!manifest) throw new UsageError(`${pagesFile(dir)} is missing: run figma-donor.mjs pages <figma-url> first`);
  if (!client?.hasToken) throw new UsageError('renders fetches PNGs over the Figma REST API: export FIGMA_TOKEN (file_content:read)');
  if (!(scale > 0 && scale <= 4)) throw new UsageError(`--scale ${scale}: 0 < scale ≤ 4`);
  const { fileKey } = parseFigmaUrl(url);
  const version = manifest._provenance?.source?.fileVersion;
  const kit = compileKit(readJsonIf(join(dir, 'reskin', 'content-rules.json')) || {});
  const root = join(cacheFor(dir, fileKey).root, '_pages', String(version).replace(/[^A-Za-z0-9._-]+/g, '-'));
  const pngDir = join(root, 'png');
  mkdirSync(pngDir, { recursive: true });

  // the public sets in full (variants and their copy), cached
  const setsPath = join(root, 'library-sets.json');
  const setIds = [...new Set((manifest.kit?.blocks || []).flatMap((b) => (b.sets?.length ? b.sets : [b.set]).map((s) => s.id)))];
  let sets = refresh ? null : readJsonIf(setsPath);
  const needSets = setIds.filter((id) => !(sets?.nodes && id in sets.nodes));
  if (needSets.length) {
    sets = { nodes: { ...(sets?.nodes || {}) } };
    for (const part of chunks(needSets, 8)) {
      const got = (await client.getJson(`/v1/files/${fileKey}/nodes`, { ids: part.join(','), version })).nodes || {};
      for (const id of part) sets.nodes[id] = got[id] ?? null;
    }
    writeJson(setsPath, sets);
  }
  const setDocs = Object.fromEntries(Object.entries(sets?.nodes || {}).filter(([, v]) => v?.document).map(([k, v]) => [k, v.document]));
  const t = renderTargets(manifest, setDocs, kit);
  for (const m of t.missing) warn(`figma-donor: ${m.block} set "${m.set}" (${m.id}) not returned by Figma`);
  let { pages, library } = t;
  if (only?.length) { pages = pages.filter((p) => only.includes(p.slug)); library = library.filter((v) => only.includes(v.block)); }

  // PNGs: one images call per 40 ids, bytes downloaded once per id and scale.
  // A breakpoint frame (a page frame, a Breakpoint=… kit variant) is a viewport: rendered at its own bounds
  // (use_absolute_bounds), so content bleeding past the frame edge does not widen the reference. A component
  // variant keeps Figma's render bounds: its overflow is a menu, tooltip or shadow the design shows.
  const framed = new Set([...pages.map((p) => p.id), ...library.filter((v) => v.breakpoint).map((v) => v.id)]);
  const fileOf = (id) => join(pngDir, `${safeId(id)}@${scale}x${framed.has(id) ? '.frame' : ''}.png`);
  const ids = [...new Set([...pages, ...library].map((x) => x.id))];
  const need = ids.filter((id) => refresh || !existsSync(fileOf(id)));
  const failed = [];
  let calls = 0;
  const batches = [...chunks(need.filter((id) => framed.has(id)), 40).map((part) => [part, true]),
    ...chunks(need.filter((id) => !framed.has(id)), 40).map((part) => [part, false])];
  for (const [part, bounds] of batches) {
    const res = await client.getJson(`/v1/images/${fileKey}`, { ids: part.join(','), scale, format: 'png', version, ...(bounds ? { use_absolute_bounds: true } : {}) });
    calls += 1;
    if (res.err) throw new UsageError(`Figma could not render: ${res.err}`);
    for (const id of part) {
      if (res.images?.[id]) writeFileAtomic(fileOf(id), await client.getBytes(res.images[id]));
      else failed.push(id);
    }
  }
  const rel = (id) => (existsSync(fileOf(id)) ? relative(dir, fileOf(id)) : null);
  const byPage = {};
  for (const p of pages) (byPage[p.slug] ||= []).push({ breakpoint: p.breakpoint, id: p.id, png: rel(p.id) });
  const byBlock = {};
  for (const v of library) (byBlock[v.block] ||= { module: v.module, used: v.used, variants: [] }).variants.push({ ...v, block: undefined, module: undefined, used: undefined, png: rel(v.id) });
  const out = {
    _provenance: { writtenBy: 'stardust:reskin/figma-donor.mjs', command: 'renders', at, source: { fileKeyHash: manifest._provenance?.source?.fileKeyHash ?? null, fileVersion: version }, scale, note: 'Figma PNG renders the exact and library gates compare against; library variants carry the copy the block must show' },
    version: RENDERS_VERSION, scale, pages: byPage, library: byBlock, failed,
  };
  if (only?.length) {
    const prev = readJsonIf(rendersFile(dir));
    if (prev) { out.pages = { ...prev.pages, ...out.pages }; out.library = { ...prev.library, ...out.library }; }
  }
  writeJson(rendersFile(dir), out);
  return { file: rendersFile(dir), out, calls, fetched: need.length - failed.length, failed, counts: { pages: pages.length, variants: library.length, blocks: Object.keys(byBlock).length } };
}
