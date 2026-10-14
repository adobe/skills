// skills/reskin/scripts/figma/capture.mjs — runCapture: the network half of figma-donor.mjs. Reads
// one file version over REST (files depth=2 → nodes → variables/local → images, every call after the
// first pinned with version=<v>), caches raw responses and image bytes, then writes the capture
// outputs under <dir>/canon-source/. With a complete cache and no --refresh it rebuilds every output
// from the cache: no request, no token. A run stopped part-way (a long 429) keeps what it fetched; the
// next run for the same selection reuses the cached nodes response and image bytes.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cacheFor, writeCurrent } from './cache.mjs';
import { FigmaError, UsageError } from './errors.mjs';
import { buildFoundation, FOUNDATION_FILES } from './foundation.mjs';
import { readJsonIf, provenance, writeFileAtomic, writeJson } from './io.mjs';
import { parseFigmaUrl } from './url.mjs';

const FRAME_TYPES = new Set(['FRAME', 'SECTION', 'INSTANCE', 'COMPONENT']);
const NOT_RENDERED = 'authored from Figma REST node data, not browser-rendered';
const LARGE_BYTES = 5 * 1024 * 1024;

// --frames wins; else the URL's node (a page → its top-level frames; anything else → itself); else
// every top-level frame of every page, in document order.
function selectFrames(file, nodeId, frames) {
  const pages = (file.document?.children || []).filter((p) => p.type === 'CANVAS');
  const tops = (page) => (page.children || []).filter((c) => c.visible !== false && FRAME_TYPES.has(c.type)).map((c) => c.id);
  if (frames?.length) return { all: frames, discovered: frames.length };
  if (nodeId) {
    const page = pages.find((p) => p.id === nodeId);
    const all = page ? tops(page) : [nodeId];
    return { all, discovered: all.length };
  }
  const all = pages.flatMap(tops);
  return { all, discovered: all.length };
}

export async function runCapture({ url, frames = null, maxFrames = 25, refresh = false, dir = 'stardust', client, now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), warn = (m) => process.stderr.write(`${m}\n`) }) {
  const { fileKey, mainFileKey, nodeId } = parseFigmaUrl(url);
  const cache = cacheFor(dir, fileKey);
  const request = { nodeId, frames, maxFrames };
  const latest = cache.latest();

  if (latest && !refresh) {
    const v = cache.version(latest.version);
    const manifest = v.read('manifest.json');
    if (!manifest) throw new UsageError(`the cache at ${cache.root} has no manifest for version ${latest.version}; re-run with --refresh`);
    if (JSON.stringify(manifest.request) !== JSON.stringify(request)) {
      throw new UsageError(`the cache at ${cache.root} holds a different selection (node ${manifest.request.nodeId ?? 'none'}, frames ${manifest.request.frames?.join(',') ?? 'default'}, max ${manifest.request.maxFrames}); re-run with --refresh to fetch this one`);
    }
    const written = writeOutputs({ dir, manifest, v });
    return { manifest, written, fromCache: true };
  }

  const endpoints = [];
  const file = await client.getJson(`/v1/files/${fileKey}`, { depth: 2 });
  const version = String(file.version ?? '');
  if (!version) throw new FigmaError(`Figma returned no version for file ${fileKey}`, { exitCode: 3 });
  endpoints.push({ name: 'files', status: 'ok' });
  const v = cache.version(version);
  v.write('file.json', file);

  const { all, discovered } = selectFrames(file, nodeId, frames);
  if (!all.length) throw new UsageError('no top-level frames to capture: pass --frames <id,id> or a URL with a node-id');
  const selected = all.slice(0, maxFrames);
  const cut = all.slice(maxFrames);
  if (cut.length) warn(`figma-donor: ${discovered} top-level frames; capturing the first ${selected.length} (--max-frames ${maxFrames}). Cut: ${cut.join(', ')}`);
  const resume = JSON.stringify(v.read('selection.json')) === JSON.stringify({ frames: selected });
  v.write('selection.json', { frames: selected });

  let nodes = resume ? v.read('nodes.json') : null;
  if (nodes) endpoints.push({ name: 'nodes', status: 'ok (cached)' });
  else {
    nodes = await client.getJson(`/v1/files/${fileKey}/nodes`, { ids: selected, version });
    v.write('nodes.json', nodes);
    endpoints.push({ name: 'nodes', status: 'ok' });
  }
  const size = Buffer.byteLength(readFileSync(v.path('nodes.json')));
  if (size > LARGE_BYTES) warn(`figma-donor: the nodes response is ${(size / 1048576).toFixed(1)} MB; read it with bounded readers, or narrow --frames`);
  const missing = selected.filter((id) => !nodes.nodes?.[id]?.document);
  if (missing.length) warn(`figma-donor: Figma returned no node for ${missing.join(', ')} (deleted, or not in this file version)`);

  try {
    v.write('variables.json', await client.getJson(`/v1/files/${fileKey}/variables/local`, { version }));
    endpoints.push({ name: 'variables', status: 'ok' });
  } catch (e) {
    if (!(e instanceof FigmaError) || (e.status !== 403 && e.status !== 404)) throw e;
    rmSync(v.path('variables.json'), { force: true });
    endpoints.push({ name: 'variables', status: 'unavailable (plan)' });
  }

  const renderable = selected.filter((id) => !missing.includes(id));
  const imageMap = {};
  const pending = renderable.filter((id) => !(resume && v.has(v.imageFile(id))));
  let urls = {};
  if (pending.length) {
    const res = await client.getJson(`/v1/images/${fileKey}`, { ids: pending, scale: 1, format: 'png', version });
    if (res.err) throw new FigmaError(`Figma could not render the frames: ${res.err}`, { exitCode: 3 });
    urls = res.images || {};
  }
  for (const id of renderable) {
    if (!pending.includes(id)) { imageMap[id] = v.imageFile(id); continue; }
    if (!urls[id]) { imageMap[id] = null; continue; }
    writeFileAtomic(v.path(v.imageFile(id)), await client.getBytes(urls[id]));
    imageMap[id] = v.imageFile(id);
  }
  v.write('images.json', imageMap);
  endpoints.push({ name: 'images', status: 'ok' });
  const notRenderable = renderable.filter((id) => !imageMap[id]);
  if (notRenderable.length) warn(`figma-donor: Figma rendered no image for ${notRenderable.join(', ')} (empty or invisible frames)`);

  const manifest = {
    fileKey, mainFileKey, nodeId, version, capturedAt: now(),
    request, frames: selected, cut, missing, totalDiscovered: discovered,
    endpoints, planTier: client.planTier ?? null,
  };
  v.write('manifest.json', manifest);
  cache.setLatest(version);
  const written = writeOutputs({ dir, manifest, v });
  return { manifest, written, fromCache: false };
}

// Every output is a pure function of the cache: a cached re-run writes the same bytes.
function writeOutputs({ dir, manifest, v }) {
  const file = v.read('file.json');
  const nodes = v.read('nodes.json');
  const imageMap = v.read('images.json') || {};
  const cs = join(dir, 'canon-source');
  const raw = (name) => `${dir}/.work/reskin/figma/${manifest.fileKey}/${manifest.version}/${name}`;
  const prov = (names, note) => provenance({ at: manifest.capturedAt, readArtifacts: names.map(raw), note });
  const { foundation, roleCandidates, moduleCandidates, specTables } = buildFoundation({ file, nodes, frameIds: manifest.frames });
  const written = [];
  const out = (rel, obj) => { writeJson(join(cs, rel), obj); written.push(`${dir}/canon-source/${rel}`); };

  for (const f of FOUNDATION_FILES) out(`foundation/${f}.json`, { _provenance: prov(['nodes.json']), ...foundation[f] });
  out('role-candidates.json', { _provenance: prov(['nodes.json'], 'candidates only: the agent authors reskin/curation-rules.json roles from these'), ...roleCandidates });
  out('module-candidates.json', { _provenance: prov(['file.json', 'nodes.json']), ...moduleCandidates });
  out('spec-tables.json', { _provenance: prov(['nodes.json'], 'TEXT nodes whose characters parse as a JSON object'), tables: specTables });

  const shots = join(cs, 'assets', 'screenshots');
  const previous = readJsonIf(join(shots, 'index.json')) || {};
  const index = { _provenance: prov(['images.json']) };
  for (const f of moduleCandidates.frames) {
    const img = imageMap[f.node];
    index[f.slug] = { node: f.node, width: f.width, height: f.height, version: manifest.version, renderable: Boolean(img) };
    if (img) {
      const dest = join(shots, `${f.slug}.png`);
      writeFileAtomic(dest, readFileSync(v.path(img)));
      written.push(`${dir}/canon-source/assets/screenshots/${f.slug}.png`);
    }
  }
  for (const slug of Object.keys(previous)) {
    if (!slug.startsWith('_') && !(slug in index)) rmSync(join(shots, `${slug}.png`), { force: true });
  }
  out('assets/screenshots/index.json', index);

  const crawlPath = `${dir}/canon-source/_crawl-log.json`;
  out('_crawl-log.json', {
    _provenance: prov(['manifest.json']),
    discovery: {
      method: 'figma-rest',
      fetchTechnique: 'figma-rest',
      fileKey: manifest.fileKey,
      version: manifest.version,
      totalDiscovered: manifest.totalDiscovered,
      selected: manifest.frames,
      cut: manifest.cut,
      missing: manifest.missing,
    },
    consent: null,
    crawl: { endpoints: manifest.endpoints, planTier: manifest.planTier },
    visionCheck: [],
    siblingCandidates: [],
    notBrowserRendered: Object.fromEntries([...written, crawlPath].map((p) => [p, NOT_RENDERED])),
  });
  writeCurrent(dir, manifest.fileKey, manifest.version);
  return written;
}
