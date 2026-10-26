// skills/reskin/scripts/figma/pages-run.mjs — the I/O half of figma-donor.mjs pages | content --all (reskin
// Phase 2′, Figma-only sites; reference/content-model.md § Pages and kit). figma/pages.mjs is the pure core.
//
// pages: the file's canvases (depth 1) → their groups; the `pages` canvases (depth 2) → every page and its
// breakpoints; each page frame (full depth, cached per frame under <cache root>/_pages/<version>/, which a
// capture's promote never touches) → the kit instances; the instanced sets' home canvases (ids-pruned file
// response) → the kit registry. Writes <dir>/reskin/figma-pages.json: pages, skipped frames, the kit blocks
// (one per set used, module M1…), off-kit and unused kit, the chrome page, NODE-link map, the frames capture
// must render for the modules (captureFrames) and the curation-rules modules[] seed. The library is every
// template/component canvas (nodes depth kit.depth, cached as kit-canvases-d<depth>.json): each is a block
// whether a page instances it or not; pages bind only the blocks they use.
// content --all: runContent per page (chrome page first, its chrome only), each section bound to its kit
// block, then <dir>/reskin/mapping.seed.json — mapping.json's shape with module/block/variant per slot.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { safeId } from './content.mjs';
import { buildKitRegistry, chromeSource, classifyCanvases, compileKit, discoverPages, homesFrom, instanceKit, KIT_GROUPS, kitLibrary, linkMap, moduleSeed, PAGES_VERSION, topInstances, unusedKit } from './pages.mjs';
import { cacheFor } from './cache.mjs';
import { locate, runContent } from './content-run.mjs';
import { readJsonIf, writeJson } from './io.mjs';
import { UsageError } from './errors.mjs';
import { parseFigmaUrl, canonicalFigmaUrl } from './url.mjs';

export const pagesFile = (dir) => join(dir, 'reskin', 'figma-pages.json');
export const seedFile = (dir) => join(dir, 'reskin', 'mapping.seed.json');
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const keyHash = (k) => createHash('sha1').update(String(k)).digest('hex').slice(0, 12);

function pagesCache(dir, fileKey, version) {
  const root = join(cacheFor(dir, fileKey).root, '_pages', String(version).replace(/[^A-Za-z0-9._-]+/g, '-'));
  return {
    root,
    read: (name) => readJsonIf(join(root, name)),
    write: (name, obj) => { mkdirSync(root, { recursive: true }); writeJson(join(root, name), obj); },
  };
}
const frameName = (id) => `frame-${safeId(id)}.json`;

export async function runPages({ dir, url, client, at, refresh = false, confidential = false, chunk = 6, warn = () => {} }) {
  const { fileKey } = parseFigmaUrl(url);
  if (!client?.hasToken) throw new UsageError('pages reads the whole file over the Figma REST API: export FIGMA_TOKEN (file_content:read)');
  const rulesFile = readJsonIf(join(dir, 'reskin', 'content-rules.json')) || {};
  const kit = compileKit(rulesFile);

  const file = await client.getJson(`/v1/files/${fileKey}`, { depth: 1 });
  const version = file.version || 'current';
  const pc = pagesCache(dir, fileKey, version);
  const cached = (name) => (refresh ? null : pc.read(name));
  const canvases = classifyCanvases((file.document?.children || []).map((c) => ({ id: c.id, name: c.name })), kit);
  const pageCanvases = canvases.filter((c) => c.group === 'pages');
  if (!pageCanvases.length) throw new UsageError(`no pages canvas in ${fileKey}: name a marker canvas FULL PAGES (or PAGES, SCREENS) with the page canvases indented under it, or map them in content-rules.json kit.canvases { "<canvasId>": "pages" }. Canvases: ${canvases.map((c) => `"${c.name}" (${c.group || 'none'})`).join(', ')}`);

  let shallow = cached('pages-canvases.json');
  if (!shallow) { shallow = await client.getJson(`/v1/files/${fileKey}/nodes`, { ids: pageCanvases.map((c) => c.id).join(','), depth: 2, version }); pc.write('pages-canvases.json', shallow); }
  const canvasNodes = pageCanvases.map((c) => ({ canvas: c, children: shallow.nodes?.[c.id]?.document?.children || [] }));
  const { pages, skipped } = discoverPages(canvasNodes, kit);
  if (!pages.length) throw new UsageError(`the pages canvases (${pageCanvases.map((c) => c.name).join(', ')}) hold no page frames${skipped.length ? `; skipped: ${skipped.map((s) => `${s.name} (${s.why})`).join('; ')}` : ''}`);

  // every breakpoint frame of every page, full depth, cached one file per frame
  const ids = [...new Set(pages.flatMap((p) => [p.frame, p.responsive].filter(Boolean)))];
  const missing = ids.filter((id) => !cached(frameName(id)));
  for (const part of chunks(missing, chunk)) {
    const res = await client.getJson(`/v1/files/${fileKey}/nodes`, { ids: part.join(','), version });
    for (const id of part) {
      if (!res.nodes?.[id]) { warn(`figma-donor: frame ${id} came back empty`); continue; }
      pc.write(frameName(id), { name: res.name, version: res.version, nodes: { [id]: res.nodes[id] } });
    }
  }
  const frameOf = (id) => { const r = pc.read(frameName(id)); return r ? locate([r], id) : null; };

  // the block library: every template/component canvas to kit.depth (its sets and parts), used or not
  const kitCanvases = canvases.filter((c) => KIT_GROUPS.includes(c.group) && !c.marker);
  let kitRes = cached(`kit-canvases-d${kit.depth}.json`);
  if (!kitRes && kitCanvases.length) {
    kitRes = { version, nodes: {} };
    for (const part of chunks(kitCanvases.map((c) => c.id), 8)) Object.assign(kitRes.nodes, (await client.getJson(`/v1/files/${fileKey}/nodes`, { ids: part.join(','), depth: kit.depth, version })).nodes || {});
    pc.write(`kit-canvases-d${kit.depth}.json`, kitRes);
  }
  const library = kitLibrary(kitCanvases.map((c) => ({ canvas: c, document: kitRes?.nodes?.[c.id]?.document })), kit);
  for (const e of library.empty) warn(`figma-donor: kit canvas "${e.name}" ${e.why}`);

  // the home canvas of every instanced set the library does not hold (off-kit, or deeper than kit.depth)
  const keys = new Set();
  for (const p of pages) { const hit = frameOf(p.frame); if (hit) for (const n of topInstances(hit.frame)) { const k = instanceKit(n, hit.maps).key; if (k && !library.index[k]) keys.add(k); } }
  let homes = cached('homes.json')?.homes || {};
  const need = [...keys].filter((k) => !homes[k]);
  for (const part of chunks(need, 20)) Object.assign(homes, homesFrom(await client.getJson(`/v1/files/${fileKey}`, { ids: part.join(','), version }), part, canvases));
  if (need.length) pc.write('homes.json', { homes });
  homes = Object.fromEntries([...keys].map((k) => [k, homes[k] || null]));

  const reg = buildKitRegistry({ pages, frameOf, homes, kit, library });
  for (const o of reg.offKit) warn(`figma-donor: block "${o.block}" (set ${o.set.name}) is off-kit: ${o.why}`);
  const chrome = chromeSource(pages, reg.bindings);
  const manifest = {
    _provenance: { writtenBy: 'stardust:reskin/figma-donor.mjs', command: 'pages', writtenAt: at, version: PAGES_VERSION, source: { kind: 'figma', ...(confidential ? { fileKey: 'redacted', fileKeyHash: keyHash(fileKey), url: 'figma:redacted' } : { fileKey, url: canonicalFigmaUrl({ fileKey }) }), fileVersion: version, fileName: confidential ? null : file.name } },
    version: PAGES_VERSION,
    canvases,
    pages: pages.map((p) => ({ ...p, bindings: reg.bindings[p.slug] })),
    skipped,
    kit: { version: PAGES_VERSION, blockPer: kit.blockPer, blocks: reg.blocks, index: reg.index, offKit: reg.offKit, unused: unusedKit(reg.blocks), emptyCanvases: library.empty },
    chromeSource: chrome,
    links: linkMap(pages),
    captureFrames: reg.blocks.map((b) => b.set.id),
    modules: moduleSeed(reg.blocks),
  };
  writeJson(pagesFile(dir), manifest);
  return { manifest, file: pagesFile(dir), fetched: missing.length, homesFetched: need.length };
}

// mapping.json's shape, seeded from the content models' kit bindings (mapping.json itself is never written).
export function mappingSeed(dir, manifest, models) {
  const out = { _provenance: { writtenBy: 'stardust:reskin/figma-donor.mjs', command: 'content --all', note: 'copy to mapping.json and add layout/width/tone per slot; module/block/variant come from the Figma kit; library lists every kit block to build, used on a page or not' }, library: (manifest.kit?.blocks || []).map((b) => ({ block: b.block, module: b.module, group: b.group, set: b.set.id, variants: b.variants, used: b.used })), chrome: null, pages: {} };
  for (const [slug, m] of Object.entries(models)) {
    const page = manifest.pages.find((p) => p.slug === slug);
    const slots = {};
    for (const s of m.model.sections) if (s.kit?.block) slots[s.slot] = { module: s.kit.module, block: s.kit.block, variant: s.kit.variant || [], ...(s.kit.instance ? { instance: s.kit.instance } : {}) };
    out.pages[slug] = { template: page?.template || null, slots };
    if (m.chrome) {
      const chromeKit = (role) => Object.fromEntries((m.chromeSections || []).filter((c) => c.role === role && c.kit?.block).map((c) => [c.slot, { module: c.kit.module, block: c.kit.block, variant: c.kit.variant || [] }]));
      out.chrome = { model: join(dir, 'reskin', 'content-model', '_chrome'), header: m.chrome.header, footer: m.chrome.footer, kit: { ...chromeKit('header'), ...chromeKit('footer') } };
    }
  }
  return out;
}

export async function runContentAll({ dir, url, client, stateLib, at, only = null, force = false, confidential = false, warn = () => {} }) {
  const manifest = readJsonIf(pagesFile(dir));
  if (!manifest) throw new UsageError(`${pagesFile(dir)} is missing: run figma-donor.mjs pages <figma-url> first`);
  const { fileKey } = parseFigmaUrl(url);
  const fileVersion = manifest._provenance?.source?.fileVersion;
  const pc = pagesCache(dir, fileKey, fileVersion);
  let list = manifest.pages;
  if (only?.length) {
    const unknown = only.filter((s) => !list.some((p) => p.slug === s));
    if (unknown.length) throw new UsageError(`--only: ${unknown.join(', ')} not in ${pagesFile(dir)} (pages: ${list.map((p) => p.slug).join(', ')})`);
    list = list.filter((p) => only.includes(p.slug));
  }
  list = [...list].sort((a, b) => (a.slug === manifest.chromeSource ? -1 : b.slug === manifest.chromeSource ? 1 : 0));
  const results = {};
  const failed = [];
  for (const p of list) {
    const preloaded = [p.frame, p.responsive].filter(Boolean).map((id) => pc.read(frameName(id))).filter(Boolean);
    try {
      const r = await runContent({ dir, url, frameId: p.frame, slug: p.slug, responsiveId: p.responsive, pages: manifest.links, noChrome: p.slug !== manifest.chromeSource, force, confidential, client, stateLib, at, warn, preloaded, kit: manifest.kit });
      results[p.slug] = { ...r, chromeSections: r.chrome ? readJsonIf(join(dir, 'reskin', 'content-model', '_chrome', 'content-model.json'))?.sections : null };
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      failed.push({ slug: p.slug, why: e.message });
    }
  }
  const prev = readJsonIf(seedFile(dir));
  const seed = mappingSeed(dir, manifest, results);
  if (prev && only?.length) { seed.pages = { ...(prev.pages || {}), ...seed.pages }; seed.chrome ??= prev.chrome ?? null; }
  writeJson(seedFile(dir), seed);
  return { results, failed, seed, file: seedFile(dir) };
}
