/**
 * migrate/encode/shape.mjs — C14 (skipping a sibling's local harness launches): a page's shape signature, a template's
 * harness key, the archetype's `passedOn` record and the coverage rule over them. A library module (no CLI); nothing
 * runs on import. The launches are section-schema, the whole-page block-roundtrip --ew and qa-gate; an encoded sibling
 * may skip them only when the archetype (or an earlier page of its template) passed them under the current key on
 * every block shape the sibling has. Everything else (the gate-all row, the lints, media-reconcile, the content count)
 * still runs on every page.
 *
 * Shape — shapeOf(html) of a delivered-form document (the encoder's output, or a gated content/<path>.html):
 *   [{ block: "<name>[ <variant>…]", rows: <n>, cells: ["<kind>,<kind>…" one string per row] }], one entry per block in
 *   document order. A block is a <div> with a class directly in a section (a child of <main>), metadata and
 *   section-metadata excepted; its variants are sorted (block code reads the class list, never its order). A cell's
 *   kind: `empty` (no text, no image), `image` (an <img>/<picture>, no text), `text` (text, no image) or `image+text`;
 *   text is any character other than ASCII whitespace and NBSP. Whitespace and inline markup never change a shape.
 *   The encoder records it as `audit.encode.shape` on a clean encode.
 *
 * Coverage — covers(shape, exercised[]): each block of `shape` needs a block of the same name and variants in the
 *   exercised shapes, a row count within the [min, max] they show for it, and every one of its row strings among
 *   theirs. → { covered, gaps[] }.
 *
 * Harness key — harnessKey(root, archetype) → { key: "sha256:<64hex>", blocks[] }: sha256 over the compact JSON of
 *   { encoder: encoderKey(), map: mapKey(root, archetype) — provenance.mjs's, the same values as a sidecar's `encode`
 *   and state.json.migrate.generators; blocks: every file under blocks/<b>/ for each block the map emits (`block:<b>`);
 *   foundation: the frozen set that stardust/rollout/foundation-freeze.json names (its `paths`), hashed from disk now —
 *   its `files` while foundation-freeze.mjs check passes, so a foundation edit moves the key even before a re-freeze;
 *   null without a manifest }. Files are hashed by foundation-freeze.mjs's own snapshot() (replica skill, either layout:
 *   lstat, symlinks by their link text, dot-entries and node_modules skipped). Any edit to the encoder, the map, a block
 *   the map emits or the foundation moves the key: every earlier pass is void and the launches re-arm. The encoder part
 *   is the sha over encode.mjs and its whole static import closure (migrate.mjs and the deploy modules it loads
 *   included): an update of those scripts re-arms too — never a write, only the representatives' launches once more.
 *
 * passedOn — the archetype's sidecar key (migrate.mjs harness <slug> records it; migrate's re-render carries it):
 *   { key, shapes: [{ slug, shape }] } sorted by slug — the pages that passed the launches under `key`, each with the
 *   shape of its current clean encode; a pass under another key replaces the whole record.
 *
 * Readers: rollout plan.mjs (planHarness: needsHarness per page), replica gate-evidence.mjs (inherited: a sibling with
 *   no local-harness evidence is accepted only when passedOn under the current key covers its shape).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attr, decodeEntities, kids, parseHTML, textOf, walk } from './dom.mjs';
import { currentEncode, encoderKey, mapKey, sha256 } from './provenance.mjs';

export const FREEZE_MANIFEST = 'stardust/rollout/foundation-freeze.json';
const HERE = dirname(fileURLToPath(import.meta.url));
const NOT_BLOCKS = new Set(['metadata', 'section-metadata']);
const BLANK = /[\t\n\f\r \u00a0]/g;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const short = (h) => (typeof h === 'string' ? `${h.slice(0, 19)}…` : 'none');
const classesOf = (n) => String(attr(n, 'class') || '').split(/\s+/).filter(Boolean);
const safeSlug = (s) => typeof s === 'string' && /^[^/\\]+$/.test(s) && !s.startsWith('.');

// ---- shape ---------------------------------------------------------------------------------------------------------
function cellKind(cell) {
  const image = [...walk(cell)].some((n) => n.tag === 'img' || n.tag === 'picture');
  const text = decodeEntities(textOf(cell)).replace(BLANK, '') !== '';
  return image && text ? 'image+text' : image ? 'image' : text ? 'text' : 'empty';
}

/** The page's block shape (above) from a delivered-form document. */
export function shapeOf(html) {
  const doc = parseHTML(String(html));
  const main = [...walk(doc)].find((n) => n.tag === 'main');
  if (!main) return [];
  const shape = [];
  for (const section of kids(main)) {
    for (const node of kids(section)) {
      const [name, ...variants] = classesOf(node);
      if (node.tag !== 'div' || !name || NOT_BLOCKS.has(name)) continue;
      const rows = kids(node);
      shape.push({ block: [name, ...variants.sort()].join(' '), rows: rows.length, cells: rows.map((r) => kids(r).map(cellKind).join(',')) });
    }
  }
  return shape;
}

export const isShape = (v) => Array.isArray(v) && v.every((b) => isObj(b) && typeof b.block === 'string' && b.block !== ''
  && Number.isInteger(b.rows) && b.rows >= 0 && Array.isArray(b.cells) && b.cells.length === b.rows && b.cells.every((c) => typeof c === 'string'));

// ---- coverage ------------------------------------------------------------------------------------------------------
/** Is every block of `shape` exercised by the shapes in `exercised`? → { covered, gaps[] } */
export function covers(shape, exercised) {
  const seen = new Map();
  for (const page of exercised) {
    for (const b of page) {
      const s = seen.get(b.block) || { min: b.rows, max: b.rows, rows: new Set() };
      s.min = Math.min(s.min, b.rows); s.max = Math.max(s.max, b.rows);
      for (const r of b.cells) s.rows.add(r);
      seen.set(b.block, s);
    }
  }
  const gaps = [];
  for (const b of shape) {
    const s = seen.get(b.block);
    if (!s) { gaps.push(`block "${b.block}" is new`); continue; }
    if (b.rows < s.min || b.rows > s.max) gaps.push(`"${b.block}" has ${b.rows} rows (exercised ${s.min === s.max ? s.min : `${s.min}–${s.max}`})`);
    for (const r of b.cells) if (!s.rows.has(r)) gaps.push(`"${b.block}" has a row of cells [${r}] (new)`);
  }
  const uniq = [...new Set(gaps)];
  return { covered: uniq.length === 0, gaps: uniq };
}

export const isPassedOn = (v) => isObj(v) && typeof v.key === 'string' && Array.isArray(v.shapes)
  && v.shapes.every((e) => isObj(e) && safeSlug(e.slug) && isShape(e.shape));

/** The archetype's passedOn after `slug` passed the launches under `key` with `shape` (another key: a new record). */
export function passedOnWith(old, { key, slug, shape }) {
  const kept = isPassedOn(old) && old.key === key ? old.shapes.filter((e) => e.slug !== slug) : [];
  const shapes = [...kept, { slug, shape }].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { key, shapes };
}

/**
 * The skip rule's coverage half: may a page with this shape inherit the launches? → { ok, why }. Only a passedOn under
 * the current key counts (any key change re-arms); the rest of the rule — a current clean encode under this map and
 * encoder — is encodedShape()'s.
 */
export function inherited({ key, passedOn, shape }) {
  if (!key) return { ok: false, why: 'no harness key' };
  if (!isPassedOn(passedOn)) return { ok: false, why: 'the archetype records no harness pass (passedOn)' };
  if (passedOn.key !== key) return { ok: false, why: `the harness key moved since the recorded pass (${short(passedOn.key)} → ${short(key)})` };
  if (!isShape(shape)) return { ok: false, why: 'no shape recorded' };
  const c = covers(shape, passedOn.shapes.map((e) => e.shape));
  if (!c.covered) return { ok: false, why: `shape not covered: ${c.gaps.join('; ')}` };
  return { ok: true, why: `covered by passedOn under ${short(key)} (${passedOn.shapes.map((e) => e.slug).join(', ')})` };
}

/**
 * needsHarness for one template's pages, in delivery order (the archetype first). A page runs the launches unless
 * passedOn under the current key covers its shape, or — a sibling that converts no block (no block code is written for
 * it) — the pages flagged before it in this plan will once they pass (an earlier sibling with a new shape becomes that
 * shape's representative). A page that is not a current clean encode under the template's map, or with no key, runs
 * them.
 *   key, keyError  the current harness key, or null and why it could not be computed
 *   passedOn       the archetype's record
 *   pages          [{ slug, isArchetype, encoded: encodedShape()'s { ok, why, shape } | null, convert: [<block>…] }]
 * → Map slug → { needsHarness, why }
 */
export function planHarness({ key, keyError = null, passedOn, pages }) {
  const passed = key && isPassedOn(passedOn) && passedOn.key === key ? passedOn.shapes : [];
  const moved = Boolean(key) && isPassedOn(passedOn) && passedOn.key !== key;
  const pending = [];
  const out = new Map();
  for (const p of pages) {
    const run = (why) => { out.set(p.slug, { needsHarness: true, why }); if (p.encoded?.ok && isShape(p.encoded.shape)) pending.push({ slug: p.slug, shape: p.encoded.shape }); };
    if (!key) { run(`no harness key (${keyError || 'unknown'})`); continue; }
    if (!p.encoded) { run('not an encoded page: it runs the launches'); continue; }
    if (!p.encoded.ok) { run(p.encoded.why); continue; }
    const now = inherited({ key, passedOn, shape: p.encoded.shape });
    if (now.ok) { out.set(p.slug, { needsHarness: false, why: now.why }); continue; }
    if (p.isArchetype) { run(now.why); continue; }
    if (p.convert && p.convert.length) { run(`block code is written for it (converts ${p.convert.join(', ')})`); continue; }
    if (!passed.length && !pending.length) { run(now.why); continue; }
    const later = covers(p.encoded.shape, [...passed, ...pending].map((e) => e.shape));
    if (later.covered && pending.length) { out.set(p.slug, { needsHarness: false, why: `covered once ${pending.map((e) => e.slug).join(', ')} pass the launches` }); continue; }
    run(`new shape: ${later.gaps.join('; ')}${moved ? ` (${now.why})` : ''}`);
  }
  return out;
}

// ---- the harness key -----------------------------------------------------------------------------------------------
const freezeCandidates = () => [join(HERE, '..', '..', '..', 'replica', 'scripts', 'foundation-freeze.mjs'), join(HERE, '..', '..', 'replica', 'foundation-freeze.mjs')];
let freeze = null;
async function loadFreeze() {
  if (!freeze) {
    const f = freezeCandidates().find((p) => existsSync(p));
    if (!f) throw new Error(`replica's foundation-freeze.mjs not found: looked in ${freezeCandidates().join(' and ')}`);
    freeze = await import(pathToFileURL(f).href);
  }
  return freeze;
}

/** The block names a map emits (markers' `block:<name> …` emitters), sorted. */
export function mapBlocks(vocab) {
  const names = new Set();
  for (const m of (isObj(vocab) && Array.isArray(vocab.markers) ? vocab.markers : [])) {
    const e = isObj(m) && typeof m.emitter === 'string' ? /^block:([a-z0-9][a-z0-9-]*)/.exec(m.emitter) : null;
    if (e) names.add(e[1]);
  }
  return [...names].sort();
}

function readJsonFile(file, what) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`${what}: unreadable (${e.code || e.message})`); }
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${what}: invalid JSON (${e.message})`); }
}

/** The template's harness key (above). Throws when it cannot be computed (no map, a broken freeze manifest, a file error). */
export async function harnessKey(root, archetype) {
  if (!safeSlug(archetype)) throw new Error(`not an archetype slug: ${archetype}`);
  const abs = resolve(root);
  const vocabRel = `stardust/import/${archetype}/vocabulary.json`;
  const vocab = readJsonFile(join(abs, vocabRel), vocabRel);
  if (vocab === null) throw new Error(`no map ${vocabRel}: the template is not encoded`);
  const { snapshot } = await loadFreeze();
  const blocks = mapBlocks(vocab);
  const manifest = readJsonFile(join(abs, FREEZE_MANIFEST), FREEZE_MANIFEST);
  if (manifest !== null && !(isObj(manifest) && Array.isArray(manifest.paths) && manifest.paths.every((p) => typeof p === 'string'))) throw new Error(`${FREEZE_MANIFEST}: not a foundation-freeze manifest (needs paths[])`);
  const frozenRoot = manifest && typeof manifest.root === 'string' ? (isAbsolute(manifest.root) ? manifest.root : resolve(abs, manifest.root)) : abs;
  const parts = {
    encoder: encoderKey(),
    map: mapKey(abs, archetype),
    blocks: snapshot(abs, blocks.map((b) => `blocks/${b}/`)),
    foundation: manifest ? snapshot(frozenRoot, manifest.paths) : null,
  };
  return { key: sha256(JSON.stringify(parts)), blocks };
}

// ---- an encoded page's shape ---------------------------------------------------------------------------------------
/**
 * The shape of a page's current clean encode under the template's map and the current encoder → { ok, why, shape }.
 *   root, sidecarPath (project-relative), archetype, manifests (currentEncode's cache), keys = { encoder, map } (the
 *   current encoderKey() and mapKey(root, archetype); computed when absent).
 */
export function encodedShape({ root, sidecarPath, archetype, manifests = null, keys = null }) {
  const v = currentEncode({ root, sidecarPath, archetype, manifests });
  if (!v.ok) return { ok: false, why: `encode ${v.kind}: ${v.why}` };
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(root, sidecarPath), 'utf8')); } catch { /* currentEncode just read it */ }
  const enc = isObj(meta) && isObj(meta.encode) ? meta.encode : {};
  const k = keys || { encoder: encoderKey(), map: mapKey(root, archetype) };
  const e = isObj(enc.encoder) ? enc.encoder : {}; const m = isObj(enc.map) ? enc.map : {};
  if (m.template !== archetype) return { ok: false, why: `encoded under the map of ${m.template ?? 'no template'}, not ${archetype}'s` };
  if (e.sha !== k.encoder.sha || e.version !== k.encoder.version || m.vocabularySha !== k.map.vocabularySha || (m.transformSha ?? null) !== (k.map.transformSha ?? null)) {
    return { ok: false, why: `encoded under an earlier ${e.sha !== k.encoder.sha || e.version !== k.encoder.version ? 'encoder' : 'map'} — re-encode (encode.mjs --template ${archetype})` };
  }
  const shape = isObj(meta.audit) && isObj(meta.audit.encode) ? meta.audit.encode.shape : undefined;
  if (!isShape(shape)) return { ok: false, why: `no shape in ${sidecarPath} audit.encode — re-encode (encode.mjs --template ${archetype})` };
  return { ok: true, why: 'the current clean encode', shape };
}

