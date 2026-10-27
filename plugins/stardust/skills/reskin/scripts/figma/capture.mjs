// skills/reskin/scripts/figma/capture.mjs — runCapture: the network half of figma-donor.mjs. Reads
// one file version over REST (files depth=2 → nodes → variables/local → images, every call after the
// first pinned with version=<v>), caches raw responses and image bytes, then writes the capture
// outputs under <dir>/canon-source/. With a complete cache and no --refresh it rebuilds every output
// from the cache: no request, no token. A capture is built in a staging dir and swapped in whole when
// it is complete, so a run stopped part-way (a long 429) or failing keeps what it fetched for the next
// run of the same selection and never touches the last complete capture, even of the same version.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cacheFor, cacheProblem, writeCurrent } from './cache.mjs';
import { FigmaError, UsageError } from './errors.mjs';
import { buildFoundation, FOUNDATION_FILES } from './foundation.mjs';
import { assertIgnored } from './guard.mjs';
import { readJsonIf, provenance, writeFileAtomic, writeJson } from './io.mjs';
import { parseFigmaUrl } from './url.mjs';

const FRAME_TYPES = new Set(['FRAME', 'SECTION', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
const NOT_RENDERED = 'authored from Figma REST node data, not browser-rendered';
const LARGE_BYTES = 5 * 1024 * 1024;
// Past this many frames a capture says how many it is taking (it never stops for it).
const LARGE_SELECTION = 25;
// Frames per nodes / images request: a page frame is ~1 MB of node data and a large render.
export const BATCH = 5;
const batches = (ids) => Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));

// --frames wins; else every visible top-level frame, section, instance, component and component set
// of every page, in document order: a kit's modules, components and template sections all sit at the
// top level of its pages, and a shared link names whatever page the designer had open. The URL's
// node-id never narrows: it is recorded as the linked node and its page, and a top-level node it names
// is captured whatever its type.
function selectFrames(file, nodeId, frames) {
  const pages = (file.document?.children || []).filter((p) => p.type === 'CANVAS');
  const tops = (page) => (page.children || []).filter((c) => c.visible !== false && (FRAME_TYPES.has(c.type) || c.id === nodeId)).map((c) => c.id);
  const page = nodeId ? pages.find((p) => p.id === nodeId || (p.children || []).some((c) => c.id === nodeId)) : null;
  const linked = nodeId ? { node: nodeId, page: page ? { node: page.id, name: page.name } : null } : null;
  const all = frames?.length ? frames : pages.flatMap(tops);
  return { all, discovered: all.length, linked, pages: pages.length };
}

// The selection a cached capture answers for; the node-id is not part of it. Older caches also
// recorded the node-id, so they never match and ask for --refresh.
const describe = (r = {}) => `${'nodeId' in r ? `node ${r.nodeId ?? 'none'}, ` : ''}frames ${r.frames?.join(',') ?? 'all'}, max ${r.maxFrames ?? 'none'}`;

// A frame Figma cannot render (a render timeout on a huge component set) is recorded and skipped; a
// failed batch is retried one frame at a time. Blocked (401/403/429), 404 and network stay fatal, and
// so does a 5xx on a single frame: the run stops resumable instead of caching a gap.
const renderFailure = (e, single) => e instanceof FigmaError && (e.status === 400 || (e.status >= 500 && !single));

export async function runCapture({ url, frames = null, maxFrames = null, refresh = false, confidential = false, dir = 'stardust', client, now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), warn = (m) => process.stderr.write(`${m}\n`) }) {
  const { fileKey, mainFileKey, nodeId } = parseFigmaUrl(url);
  const cache = cacheFor(dir, fileKey);
  const request = { frames, maxFrames };
  const latest = cache.latest();
  // --confidential: the CLI checks the fixed outputs before any request; every other destination — a
  // capture parked or put back by a swap, and what depends on the file version, the frames and their
  // names — is checked here, each set before its first write or move.
  const guard = (entries) => { if (confidential) assertIgnored(entries, { dir }); };
  const cachePath = (p) => [relative(dir, p), '.work/'];
  guard(cache.moveTargets().map(cachePath));
  cache.recover();

  if (latest && !refresh) {
    const v = cache.version(latest.version);
    const manifest = v.read('manifest.json');
    if (!manifest) throw new UsageError(`the cache at ${cache.root} has no manifest for version ${latest.version}; re-run with --refresh`);
    if (JSON.stringify(manifest.request) !== JSON.stringify(request)) {
      throw new UsageError(`the cache at ${cache.root} holds a different selection (${describe(manifest.request)}; this run: ${describe(request)}); re-run with --refresh to fetch this one`);
    }
    const problem = cacheProblem(v, manifest);
    if (problem) throw new UsageError(`the cache at ${v.dir} is inconsistent: ${problem}. Re-run with --refresh to rebuild it.`);
    const stalled = cache.stalled();
    const newer = stalled.filter((s) => s !== latest.version);
    if (newer.length) warn(`figma-donor: a newer capture (version ${newer.join(', ')}) stopped part-way; using the complete cached version ${latest.version}. Re-run with --refresh to finish it.`);
    if (stalled.includes(latest.version)) warn(`figma-donor: a refresh of version ${latest.version} stopped part-way; the complete cached capture is unchanged and is used. Re-run with --refresh to finish it.`);
    const written = writeOutputs({ dir, manifest, v, confidential, guard, warn });
    return { manifest, written, fromCache: true };
  }

  guard([cachePath(join(cache.root, 'latest.json'))]);
  const endpoints = [];
  const file = await client.getJson(`/v1/files/${fileKey}`, { depth: 2 });
  const version = String(file.version ?? '');
  if (!version) throw new FigmaError(`Figma returned no version for file ${fileKey}`, { exitCode: 3 });
  endpoints.push({ name: 'files', status: 'ok' });

  const { all, discovered, linked, pages } = selectFrames(file, nodeId, frames);
  if (!all.length) throw new UsageError('the file has no visible top-level frame, section, component or component set: pass --frames <id,id>');
  // Only an explicit --max-frames caps the selection; the rest are listed as cut.
  const selected = maxFrames ? all.slice(0, maxFrames) : all;
  const cut = maxFrames ? all.slice(maxFrames) : [];
  if (cut.length) warn(`figma-donor: ${discovered} top-level frames; capturing the first ${selected.length} (--max-frames ${maxFrames}). Cut: ${cut.join(', ')}`);
  else if (!frames?.length && selected.length > LARGE_SELECTION) warn(`figma-donor: capturing all ${selected.length} top-level frames across ${pages} pages (nodes and images in batches of ${BATCH}); --frames narrows, --max-frames caps`);
  // Everything below lands in staging; the version's complete capture, if any, stays as it was until
  // the manifest is written and the staging dir is promoted.
  const v = cache.staging(version, selected);
  const names = ['file.json', 'selection.json', 'nodes.json', 'variables.json', 'images.json', 'manifest.json', ...batches(selected).map((_, i) => `nodes.part-${i}.json`), ...selected.map((id) => v.imageFile(id))];
  guard([...[v, cache.version(version)].flatMap((h) => names.map((n) => cachePath(h.path(n)))), ...cache.moveTargets(version).map(cachePath)]);
  v.write('file.json', file);
  const resume = JSON.stringify(v.read('selection.json')) === JSON.stringify({ frames: selected });
  v.write('selection.json', { frames: selected });

  // Frames go in batches; each batch is cached as it lands, so a stopped run resumes where it stopped.
  let nodes = resume ? v.read('nodes.json') : null;
  if (nodes) endpoints.push({ name: 'nodes', status: 'ok (cached)', calls: 0 });
  else {
    let calls = 0;
    nodes = null;
    for (const [i, ids] of batches(selected).entries()) {
      const part = `nodes.part-${i}.json`;
      let got = v.read(part);
      if (JSON.stringify(got?.ids) !== JSON.stringify(ids)) {
        got = { ids, response: await client.getJson(`/v1/files/${fileKey}/nodes`, { ids, version }) };
        v.write(part, got);
        calls += 1;
      }
      const { nodes: some = {}, ...meta } = got.response;
      nodes ??= { ...meta, nodes: {} };
      for (const id of ids) nodes.nodes[id] = some[id] ?? null;
    }
    v.write('nodes.json', nodes);
    for (let i = 0; existsSync(v.path(`nodes.part-${i}.json`)); i += 1) rmSync(v.path(`nodes.part-${i}.json`));
    endpoints.push({ name: 'nodes', status: 'ok', calls });
  }
  const size = Buffer.byteLength(readFileSync(v.path('nodes.json')));
  if (size > LARGE_BYTES) warn(`figma-donor: the nodes response is ${(size / 1048576).toFixed(1)} MB; read it with bounded readers, or narrow --frames`);
  const missing = selected.filter((id) => !nodes.nodes?.[id]?.document);
  if (missing.length) warn(`figma-donor: Figma returned no node for ${missing.join(', ')} (deleted, or not in this file version)`);

  try {
    v.write('variables.json', await client.getJson(`/v1/files/${fileKey}/variables/local`, { version }));
    endpoints.push({ name: 'variables', status: 'ok' });
  } catch (e) {
    // Optional and unused by curate: any API failure here is recorded, never fatal.
    if (!(e instanceof FigmaError)) throw e;
    rmSync(v.path('variables.json'), { force: true });
    const status = e.status === 403 ? 'unavailable (plan)' : `unavailable (${e.status ? `HTTP ${e.status}` : 'network'})`;
    if (e.status !== 403) warn(`figma-donor: variables/local ${status}; continuing without it`);
    endpoints.push({ name: 'variables', status });
  }

  const renderable = selected.filter((id) => !missing.includes(id));
  const imageMap = {};
  const pending = renderable.filter((id) => !(resume && v.has(v.imageFile(id))));
  let imageCalls = 0;
  const renderErrors = {};
  const render = async (ids) => {
    let res;
    imageCalls += 1;
    try { res = await client.getJson(`/v1/images/${fileKey}`, { ids, scale: 1, format: 'png', version }); } catch (e) {
      if (!renderFailure(e, ids.length === 1)) throw e;
      res = { err: e.message };
    }
    if (res.err) {
      if (ids.length > 1) { for (const id of ids) await render([id]); return; }
      renderErrors[ids[0]] = String(res.err).slice(0, 300);
      return;
    }
    for (const id of ids) {
      const signed = res.images?.[id];
      if (signed) writeFileAtomic(v.path(v.imageFile(id)), await client.getBytes(signed));
    }
  };
  for (const ids of batches(pending)) await render(ids);
  for (const id of renderable) imageMap[id] = v.has(v.imageFile(id)) ? v.imageFile(id) : null;
  v.write('images.json', imageMap);
  endpoints.push({ name: 'images', status: 'ok', calls: imageCalls });
  const notRenderable = renderable.filter((id) => !imageMap[id]);
  const failedIds = Object.keys(renderErrors);
  if (failedIds.length) warn(`figma-donor: Figma could not render ${failedIds.map((id) => `${id} (${renderErrors[id]})`).join(', ')}; recorded as not renderable, capture continues`);
  const blank = notRenderable.filter((id) => !(id in renderErrors));
  if (blank.length) warn(`figma-donor: Figma rendered no image for ${blank.join(', ')} (empty or invisible frames)`);

  const manifest = {
    fileKey, mainFileKey, nodeId, linked, version, capturedAt: now(),
    request, frames: selected, cut, missing, renderErrors, totalDiscovered: discovered,
    endpoints, planTier: client.planTier ?? null,
  };
  v.write('manifest.json', manifest);
  cache.promote(version, v);
  const written = writeOutputs({ dir, manifest, v: cache.version(version), confidential, guard, warn });
  return { manifest, written, fromCache: false };
}

// capture --list: every page and its visible top-level nodes, from the cached file when there is one
// (no request, no token), else one files depth=2 call. Writes nothing.
export async function listInventory({ url, refresh = false, dir = 'stardust', client }) {
  const { fileKey } = parseFigmaUrl(url);
  const cache = cacheFor(dir, fileKey);
  const latest = cache.latest();
  let file = latest && !refresh ? cache.version(latest.version).read('file.json') : null;
  const fromCache = Boolean(file);
  if (!file) file = await client.getJson(`/v1/files/${fileKey}`, { depth: 2 });
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const lines = [];
  let count = 0;
  const pages = file.document?.children || [];
  for (const p of pages) {
    const kids = (p.children || []).filter((c) => c.visible !== false);
    count += kids.length;
    lines.push(`${p.id}  ${clean(p.name)}  (${kids.length})`);
    for (const c of kids) {
      const b = c.absoluteBoundingBox || {};
      lines.push(`  ${c.id}  ${c.type}  ${Math.round(b.width ?? 0)}x${Math.round(b.height ?? 0)}  ${clean(c.name)}`);
    }
  }
  lines.push(`${pages.length} pages, ${count} top-level nodes, file version ${file.version}${fromCache ? ' (from cache, no network)' : ''}`);
  return { lines, version: file.version, fromCache };
}

// Every output is a pure function of the cache: a cached re-run writes the same bytes.
function writeOutputs({ dir, manifest, v, confidential = false, guard = () => {}, warn = () => {} }) {
  const file = v.read('file.json');
  const nodes = v.read('nodes.json');
  const imageMap = v.read('images.json') || {};
  const cs = join(dir, 'canon-source');
  const raw = (name) => `${dir}/.work/reskin/figma/${manifest.fileKey}/${manifest.version}/${name}`;
  const prov = (names, note) => provenance({ at: manifest.capturedAt, readArtifacts: names.map(raw), note });
  const { foundation, roleCandidates, moduleCandidates, specTables } = buildFoundation({ file, nodes, frameIds: manifest.frames });
  // Childless instances (remote-library components the payload did not expand): flagged, never silent.
  const hollow = moduleCandidates.frames.flatMap((f) => (f.hollow ? [`${f.name} (${f.node})`] : f.sections.filter((x) => x.hollow).map((x) => `${f.name} › ${x.name} (${x.node})`)));
  if (hollow.length) warn(`figma-donor: ${hollow.length} frame(s) or section(s) hold only childless instances, likely remote-library components the REST payload did not expand; nothing inside them is measured (hollow: true in module-candidates.json): ${hollow.join(', ')}`);
  guard(moduleCandidates.frames.filter((f) => imageMap[f.node]).map((f) => [`canon-source/assets/screenshots/${f.slug}.png`, 'canon-source/assets/screenshots/']));
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
      linked: manifest.linked ?? null,
      renderErrors: manifest.renderErrors ?? {},
    },
    consent: null,
    crawl: { endpoints: manifest.endpoints, planTier: manifest.planTier },
    visionCheck: [],
    siblingCandidates: [],
    notBrowserRendered: Object.fromEntries([...written, crawlPath].map((p) => [p, NOT_RENDERED])),
  });
  writeCurrent(dir, manifest.fileKey, manifest.version, confidential);
  return written;
}
