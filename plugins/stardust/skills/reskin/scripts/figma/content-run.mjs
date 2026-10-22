// skills/reskin/scripts/figma/content-run.mjs — the I/O half of figma-donor.mjs init | content | blocklist | ack
// (reskin Phase 2′, Figma-only sites; reference/content-model.md § Figma-sourced models). figma/content.mjs
// is the pure core; this file reads the cached nodes response (or fetches the frames once with FIGMA_TOKEN),
// gets image bytes, sniffs their format, writes the model and its side files and adds the page row.
//
// Per page, under <dir>/reskin/content-model/<slug>/:
//   content-model.json  source.kind "figma" (the model every reskin renderer and gate reads)
//   text-ops.json       figma-text-gate's text ops (TITLE caseless, drawn-field placeholders)
//   flags.json          the run report: every flagged item; block|review items are the deploy blocklist
//                       until acknowledged (figma-donor.mjs ack) — figma-donor.mjs blocklist exits 1 while open
//   assets/<node>.<ext> image bytes, magic-byte sniffed (a supplied file under the expected name is used)
// and <dir>/reskin/deltas/<slug>.json, the delta file dom-equality, slot-coverage and deployed-gate read
// (deployed/deltas.mjs, version 1), seeded with metadata.absent unless one exists (an authored file is kept),
// and <dir>/reskin/content-model/_chrome/content-model.json (header/footer slots) unless --no-chrome.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContentModel, safeId, titleFromName } from './content.mjs';
import { cacheFor, readCurrent } from './cache.mjs';
import { readJsonIf, writeJson } from './io.mjs';
import { UsageError } from './errors.mjs';
import { parseFigmaUrl, canonicalFigmaUrl } from './url.mjs';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const OPEN = new Set(['block', 'review']);

// Magic bytes → extension; anything else is not an image we ship.
export function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = buf.slice(0, 256).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

// An SVG from a design file is untrusted markup: no script, no event handlers, no external references.
export function svgUnsafe(text) {
  return /<script|\bon[a-z]+\s*=|javascript:|<foreignObject|xlink:href\s*=\s*["'](?!#)|\bhref\s*=\s*["'](?!#)/i.test(text);
}

export const findNode = (n, id) => {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children || []) { const r = findNode(c, id); if (r) return r; }
  return null;
};

// The frame and the lookups for main-component names from a nodes response (or several).
export function locate(responses, id) {
  for (const r of responses) {
    for (const v of Object.values(r?.nodes || {})) {
      const hit = findNode(v?.document, id);
      if (hit) {
        const comps = Object.assign({}, ...responses.flatMap((x) => Object.values(x?.nodes || {}).map((y) => y?.components || {})));
        const sets = Object.assign({}, ...responses.flatMap((x) => Object.values(x?.nodes || {}).map((y) => y?.componentSets || {})));
        return { frame: hit, lookup: { component: (n) => comps[n.componentId]?.name, componentSet: (n) => sets[comps[n.componentId]?.componentSetId]?.name } };
      }
    }
  }
  return null;
}

export const keyHash = (k) => createHash('sha1').update(String(k)).digest('hex').slice(0, 12);
const modelDir = (dir, slug) => join(dir, 'reskin', 'content-model', slug);

// The #310 overwrite guard, locally: never replace a model something else wrote, or another frame's.
export function overwriteRefusal(existing, { fileKey, node }) {
  if (!existing) return null;
  const p = existing._provenance || {};
  if (p.source?.kind !== 'figma') return `it was written by ${p.writtenBy || 'an unknown writer'} from ${p.source?.kind || 'a live URL'} (a live-sourced model)`;
  const f = p.source.figma || {};
  if ((f.fileKeyHash ? f.fileKeyHash !== keyHash(fileKey) : f.fileKey !== fileKey) || f.node !== node) return `it holds frame ${p.source.figma?.node} of another capture`;
  return null;
}

// The shared delta file (deployed/deltas.mjs schema, version 1). The design declares no description and no canonical:
// those keys are asserted not carried. Empty OG/Twitter maps and an empty JSON-LD list need no entry: the model's own
// values already make the gates expect none.
const ABSENT_META = { description: 'description', canonical: 'canonical' };
export function deltasFor(model) {
  const absent = (model.metadata.declaredAbsent || []).map((k) => ABSENT_META[k]).filter(Boolean);
  return { version: 1, ...(absent.length ? { metadata: { absent } } : {}) };
}

// figma-text-gate's text ops, beside the model: what the rendered text may differ in, per Figma node.
export function textOpsFor(model) {
  const text = [];
  for (const s of model.sections) {
    const walk = (o) => {
      if (o.textCase === 'TITLE') text.push({ node: o.node, op: 'caseless', why: 'Figma TITLE vs CSS capitalize differ on some words' });
      if (o.kind === 'formControl' && o.placeholder) for (const t of o.textNodes || [o.node]) text.push({ node: t, field: o.node, op: 'attr', to: 'placeholder', text: o.placeholder, why: 'a drawn field renders its value as the placeholder attribute' });
      for (const c of o.children || []) walk(c);
    };
    s.ordered.forEach(walk);
  }
  return { chrome: 'outside the text gate (header/footer are separate slots)', text };
}

export function report(flags, acks = []) {
  const key = (f) => `${f.id}@${f.node ?? f.slot ?? '-'}`;
  const acked = new Map(acks.map((a) => [a.key, a]));
  const items = flags.map((f) => ({ key: key(f), ...f, ...(acked.has(key(f)) ? { acknowledged: acked.get(key(f)) } : {}) }));
  const open = items.filter((f) => OPEN.has(f.severity) && !f.acknowledged);
  return { items, open, counts: { block: items.filter((f) => f.severity === 'block').length, review: items.filter((f) => f.severity === 'review').length, info: items.filter((f) => f.severity === 'info').length, open: open.length } };
}

// ---- init ----------------------------------------------------------------------------------------------------
export function runInit({ dir, url, confidential, stateLib, at }) {
  const file = join(dir, 'state.json');
  const { fileKey, nodeId } = parseFigmaUrl(url);
  const src = confidential ? 'figma:redacted' : canonicalFigmaUrl({ fileKey, nodeId });
  if (existsSync(file)) {
    let st;
    try { st = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new UsageError(`${file} exists and is not valid JSON: fix or remove it`); }
    if (st.flow === 'reskin' && st.site?.contentSource?.kind === 'figma') return { state: st, created: false };
    throw new UsageError(`${file} already exists (flow ${st.flow ? `"${st.flow}"` : 'unset'}${st.site?.originUrl ? `, origin ${st.site.originUrl}` : ''}): init is for a Figma-only project with no state yet — content from a live site goes through extract`);
  }
  mkdirSync(dir, { recursive: true });
  const state = {
    _provenance: stateLib.stampProvenance({}, 'stardust:reskin/figma-donor.mjs init', at),
    site: { originUrl: null, deployUrl: null, contentSource: { kind: 'figma', url: src } },
    direction: null,
    handsOff: false,
    flow: 'reskin',
    flowChosenAt: at,
    flowSource: 'figma-only',
    pages: [],
  };
  stateLib.writeState(file, state);
  return { state, created: true };
}

// ---- content -------------------------------------------------------------------------------------------------
export async function runContent({ dir, url, frameId, slug, responsiveId = null, pages = {}, noChrome = false, force = false, confidential = false, client = null, stateLib, at, warn = () => {} }) {
  if (!SLUG_RE.test(slug)) throw new UsageError(`--slug must match ${SLUG_RE} (it becomes a path), got "${slug}"`);
  const { fileKey } = parseFigmaUrl(url);
  const statePath = join(dir, 'state.json');
  if (!existsSync(statePath)) throw new UsageError(`${statePath} is missing: run figma-donor.mjs init <figma-url> first (a Figma-only project has no extract)`);

  // nodes: the capture's cache first (no network), then a content-nodes file per frame, then REST once
  const cur = readCurrent(dir);
  const cache = cacheFor(dir, fileKey);
  const version = (cur?.fileKey === fileKey && cur.version) || cache.latest()?.version || null;
  const v = version ? cache.version(version) : null;
  const responses = [];
  const add = (r) => { if (r) responses.push(r); };
  if (v) {
    add(v.read('nodes.json'));
    for (const id of [frameId, responsiveId].filter(Boolean)) add(v.read(`content-nodes-${safeId(id)}.json`));
  }
  let hit = locate(responses, frameId);
  if (!hit || (responsiveId && !locate(responses, responsiveId))) {
    if (!client?.hasToken) throw new UsageError(`frame ${!hit ? frameId : responsiveId} is not in the cache under ${cache.root} and FIGMA_TOKEN is not set: capture it (capture <url> --frames ${[frameId, responsiveId].filter(Boolean).join(',')}) or export FIGMA_TOKEN`);
    const ids = [frameId, responsiveId].filter(Boolean).join(',');
    const res = await client.getJson(`/v1/files/${fileKey}/nodes`, { ids, ...(version ? { version } : {}) });
    const ver = version || res.version || 'current';
    for (const id of [frameId, responsiveId].filter(Boolean)) cache.version(ver).write(`content-nodes-${safeId(id)}.json`, { ...res, nodes: { [id]: res.nodes?.[id] ?? null } });
    add(res);
    hit = locate(responses, frameId);
    if (!hit) throw new UsageError(`frame ${frameId} not found in file ${fileKey}`);
  }
  const responsive = responsiveId ? locate(responses, responsiveId) : null;
  if (responsiveId && !responsive) throw new UsageError(`--responsive ${responsiveId} not found`);
  if (!hit.frame.children?.length) throw new UsageError(`node ${frameId} (${hit.frame.type}) has no children: pass a page frame (a COMPONENT_SET or page holds several — pick one variant)`);

  const out = modelDir(dir, slug);
  const existing = readJsonIf(join(out, 'content-model.json'));
  const refusal = overwriteRefusal(existing, { fileKey, node: frameId });
  if (refusal && !force) throw new UsageError(`refusing to overwrite ${join(out, 'content-model.json')}: ${refusal}. Pick another --slug, or pass --force to replace it`);

  const tokens = readJsonIf(join(dir, 'reskin', 'donor-tokens.json'));
  const rulesFile = readJsonIf(join(dir, 'reskin', 'content-rules.json')) || {};
  const rules = { ...rulesFile, pages: { ...(rulesFile.pages || {}), ...pages } };

  // pass 1: what images the frame needs; then bytes (supplied file → REST) ; pass 2: the model
  const args = { frame: hit.frame, fileKey, version: version || 'current', slug, tokens, rules, lookup: hit.lookup, capturedAt: at, responsive, pageName: hit.frame.name };
  const first = buildContentModel(args);
  const assetsDir = join(out, 'assets');
  const supplied = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const got = new Map();
  const problems = [];
  let fillUrls = null;
  for (const need of first.needs) {
    const base = need.name;
    const have = supplied.find((f) => f.replace(/\.[a-z0-9]+$/i, '') === base);
    let buf = have ? readFileSync(join(assetsDir, have)) : null;
    let origin = have ? 'supplied' : null;
    if (!buf && client?.hasToken) {
      try {
        if (need.kind === 'fill') {
          fillUrls ??= (await client.getJson(`/v1/files/${fileKey}/images`)).meta?.images || {};
          if (fillUrls[need.imageRef]) { buf = await client.getBytes(fillUrls[need.imageRef]); origin = 'figma image fill'; }
        } else {
          const r = await client.getJson(`/v1/images/${fileKey}`, { ids: need.node, format: 'svg', ...(version ? { version } : {}) });
          if (r.images?.[need.node]) { buf = await client.getBytes(r.images[need.node]); origin = 'figma svg export'; }
        }
      } catch (e) { warn(`figma-donor: image ${need.node}: ${e.message}`); }
    }
    if (!buf) { problems.push({ need, why: 'no bytes: supply them as ' + `${assetsDir}/${base}.<png|jpg|svg|webp|gif>` + (client?.hasToken ? '' : ' or set FIGMA_TOKEN') }); continue; }
    const ext = sniff(buf);
    if (!ext) { problems.push({ need, why: `the bytes are not an image (magic bytes ${buf.slice(0, 4).toString('hex')})` }); continue; }
    if (ext === 'svg' && svgUnsafe(buf.toString('utf8'))) { problems.push({ need, why: 'the SVG carries script, handlers or external references' }); continue; }
    const name = `${base}.${ext}`;
    mkdirSync(assetsDir, { recursive: true });
    if (have !== name) writeFileSync(join(assetsDir, name), buf);
    got.set(need.key, { src: `assets/${name}`, origin });
  }
  const built = buildContentModel({ ...args, assets: (k) => got.get(k) || null });
  for (const p of problems) built.flags.push({ id: 'image.bytes-missing', severity: 'block', node: p.need.node, slot: null, detail: p.why });
  built.model._provenance.source.figma.fileKeyHash = keyHash(fileKey);
  if (confidential) built.model._provenance.source.figma.fileKey = 'redacted';

  writeJson(join(out, 'content-model.json'), built.model);
  writeJson(join(out, 'text-ops.json'), { _provenance: { writtenBy: 'stardust:reskin/figma-donor.mjs', command: 'content', writtenAt: at }, ...textOpsFor(built.model) });
  // deltas.mjs rejects unknown keys (_provenance included): the file holds the schema only.
  const deltasFile = join(dir, 'reskin', 'deltas', `${slug}.json`);
  if (!existsSync(deltasFile)) { mkdirSync(join(dir, 'reskin', 'deltas'), { recursive: true }); writeJson(deltasFile, deltasFor(built.model)); }
  const prevAcks = readJsonIf(join(out, 'flags.json'))?.acknowledged || [];
  const rep = report(built.flags, prevAcks);
  writeJson(join(out, 'flags.json'), { _provenance: { writtenBy: 'stardust:reskin/figma-donor.mjs', command: 'content', writtenAt: at }, slug, counts: rep.counts, placeholderOnly: built.placeholderOnly, items: rep.items, acknowledged: prevAcks.filter((a) => rep.items.some((i) => i.key === a.key)) });

  let chromeWritten = null;
  if (!noChrome && built.chrome.length) {
    const cdir = join(dir, 'reskin', 'content-model', '_chrome');
    const prev = readJsonIf(join(cdir, 'content-model.json'));
    const pf = prev?._provenance?.source;
    const cref = !prev ? null : pf?.kind !== 'figma' ? `it is a ${pf?.kind || 'live'}-sourced chrome model` : pf.figma?.node !== frameId ? `the site chrome came from frame ${pf.figma?.node}` : null;
    if (cref && !force) warn(`figma-donor: kept ${cdir}/content-model.json (${cref}); pass --force to replace it`);
    else {
      for (const c of built.chrome) {
        for (const im of c.images) {
          const f = join(out, im.currentSrc);
          if (im.currentSrc.startsWith('assets/') && existsSync(f)) { mkdirSync(join(cdir, 'assets'), { recursive: true }); writeFileSync(join(cdir, im.currentSrc), readFileSync(f)); }
        }
      }
      writeJson(join(cdir, 'content-model.json'), { _provenance: { ...built.model._provenance, scope: 'chrome' }, metadata: built.model.metadata, sections: built.chrome, flags: [] });
      chromeWritten = { header: built.chrome.filter((c) => c.role === 'header').map((c) => c.slot), footer: built.chrome.filter((c) => c.role === 'footer').map((c) => c.slot) };
    }
  }

  // the page row: status extracted (Phase 2′ is this flow's extract), type from the frame
  const { state, file } = stateLib.readState(dir);
  const row = state.pages.find((p) => p.slug === slug);
  const src = confidential ? 'figma:redacted' : canonicalFigmaUrl({ fileKey, nodeId: frameId });
  const fields = { url: src, title: titleFromName(hit.frame.name), source: 'figma', contentModel: `${out}/content-model.json` };
  if (row) Object.assign(row, fields);
  else state.pages.push({ slug, ...fields, type: null, status: 'extracted', history: [{ status: 'extracted', at, by: 'figma-donor content' }] });
  state._provenance = stateLib.stampProvenance(state._provenance, 'stardust:reskin/figma-donor.mjs content', at);
  stateLib.writeState(file, state);

  return { model: built.model, report: rep, placeholderOnly: built.placeholderOnly, out, chrome: chromeWritten, images: { got: got.size, missing: problems.length } };
}

export function readFlags(dir, slug) {
  const f = join(modelDir(dir, slug), 'flags.json');
  const j = readJsonIf(f);
  if (!j) throw new UsageError(`${f} is missing: run figma-donor.mjs content for ${slug} first`);
  return { file: f, flags: j };
}

export function blocklist(dir, slugs) {
  return slugs.map((slug) => {
    const { flags } = readFlags(dir, slug);
    const rep = report(flags.items, flags.acknowledged || []);
    return { slug, open: rep.open, counts: rep.counts, placeholderOnly: flags.placeholderOnly };
  });
}

export function acknowledge(dir, slug, { keys, all = false, why, by, at }) {
  if (!why || why.trim().length < 8) throw new UsageError('--why needs a reason (8+ characters): the acknowledgement is the record');
  const { file, flags } = readFlags(dir, slug);
  if (flags.placeholderOnly) throw new UsageError(`${slug} is placeholder-only: there is no content to deploy — fix the design, do not acknowledge it`);
  const rep = report(flags.items, flags.acknowledged || []);
  const targets = all ? rep.open : rep.open.filter((f) => keys.includes(f.key) || keys.includes(f.id));
  if (!targets.length) throw new UsageError(`nothing to acknowledge for ${slug}${keys?.length ? ` matching ${keys.join(', ')}` : ''}: open items are ${rep.open.map((f) => f.key).join(', ') || 'none'}`);
  const acks = [...(flags.acknowledged || []), ...targets.map((f) => ({ key: f.key, by: by || 'user', at, why: why.trim() }))];
  writeJson(file, { ...flags, acknowledged: acks, counts: report(flags.items, acks).counts });
  return targets;
}
