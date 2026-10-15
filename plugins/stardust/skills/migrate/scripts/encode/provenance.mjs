/**
 * migrate/encode/provenance.mjs — the encoder's provenance and idempotency: the run's key (encoder, map), each page's
 * input key, the skip predicate, the hand-edit guard, the sidecar's `encode` / `audit.encode` keys, the per-template
 * manifest and state.json.migrate.generators. A library module (no CLI); nothing runs on import. The clock is read
 * only for encodedAt (the sidecar's, never the document's), through the caller's `now`.
 *
 * Shas are "sha256:<64hex>": an HTML file over its bytes; a JSON input (vocabulary, transform, page JSON, patches) over
 * its compact form (JSON.stringify of the parsed value; the raw bytes when it does not parse), so re-indenting a map
 * moves nothing while a key-order change still does. Never compare them with migrate.mjs's sha1/12 keys
 * (sourceCurrentSha and the rest stay migrate's own; the encoder never writes them).
 *
 *   encoder  { script: "stardust/scripts/migrate/encode.mjs" (the project copy's path, in either layout), version
 *            (ENCODER_VERSION), sha } — sha over encode.mjs and every local module it loads, transitively: relative
 *            static imports and loadDeploy('<file>') targets, each named by its path under its skill's scripts dir
 *   map      { template: <archetype>, vocabularySha, transformSha (null without transform.json) }
 *   inputs   { captureSha (stardust/current/pages/<slug>.html), pageJsonSha (<slug>.json; null when absent), siteSha
 *            (encode/site.mjs: roster, media and document ledgers, chrome map, redirects), patchesSha
 *            (stardust/patches/<slug>.json; null when absent), archetypeCaptureSha (a sibling's variance is judged
 *            against the archetype's capture; null on the archetype) }
 *
 * Sidecar — migrate's place for the page, stardust/migrated/<sidecarFor(outputPathFor(url))> (migrate.mjs's rule). Two
 * keys are the encoder's, and migrate's re-render carries both (SIDECAR_KEYS / CARRIED); no other key is touched:
 *   encode        { encoder, map, inputs, output: { path, sha }, encodedAt } — the last clean encode, i.e. what the
 *                 document on disk was written from; encodedAt changes only when output.sha does
 *   audit.encode  { status, …the engine's report (patchesApplied[] included) } — the latest run's verdict for the page:
 *                 clean, or the stop (a page that stops keeps its earlier document and `encode`; staging reads the
 *                 status). Other audit.* keys are kept.
 * A page without a sidecar gets a migrate-shaped one (SIDECAR_KEYS order): renderBranch A', fidelityTier sibling,
 * template and archetypeSource = the archetype (the archetype itself: A, archetype, null, null). A stop is recorded
 * only for a page that has a sidecar or a document — a page never encoded clean gets no sidecar from a stop.
 *
 * Manifest stardust/import/<archetype>/manifest.json: {"<project-relative document path>": "sha256:<64hex>"} — what
 *   the encoder last wrote (or adopted) at each path. Documents only; keys sorted, trailing newline, no timestamps;
 *   re-read and merged once at the end of a run, tmp + rename, rewritten only when its bytes change.
 * state.json.migrate.generators[<archetype>] = { script, sha, version, vocabularySha, transformSha } (the run's key, no
 *   timestamp): state.json is re-read, only this key is merged, tmp + rename, only when the value differs; an absent
 *   state.json is never created.
 *
 * Skip (no encode, no write): the document exists, its sha equals the manifest's and the sidecar's encode.output, the
 *   sidecar's encode.{encoder, map, inputs} equal the current key, and audit.encode.status is clean. The caller's
 *   --force bypasses it; the byte gate still decides every write.
 * Guard (before any write for a clean page; --force never overrides it): an existing document whose bytes are neither
 *   the manifest's nor the new encode's is a hand edit — the page stops `hand-edit`, nothing is written for it, unless
 *   --overwrite-hand-edit names its slug. A document the manifest does not list is therefore refused when it differs
 *   and adopted (listed, not rewritten) when it is byte-equal; a missing document is written.
 *
 * The manifest guard, the patches file and the generators record follow the `stardust/next` branch's
 * `skills/migrate/scripts/importer-skeleton.mjs` (commits 9aaeff4f, d4a37277, 7662fda2), reworked for main's sidecar contract.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDECAR_KEYS, outputPathFor, sidecarFor } from '../migrate.mjs';
import { deployPath } from './deps.mjs';

export const ENCODER_VERSION = '1';
export const ENCODER_SCRIPT = 'stardust/scripts/migrate/encode.mjs';
export const MIGRATED = 'stardust/migrated';
const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const safeSlug = (s) => typeof s === 'string' && /^[^/\\]+$/.test(s) && !s.startsWith('.');
const short = (h) => (typeof h === 'string' ? `${h.slice(0, 19)}…` : 'none');
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
// deep equality that ignores object key order (a sidecar rewritten by another tool may order its keys differently)
const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort(byCodePoint).map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

export const sha256 = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
export function readBytes(file) {
  try { return readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const jsonSha = (bytes) => {
  if (bytes === null) return null;
  try { return sha256(JSON.stringify(JSON.parse(bytes.toString('utf8')))); } catch { return sha256(bytes); }
};

/** Write `data` to `file` (tmp + rename, parent dirs created) only when the bytes differ; true when written. */
export function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const old = readBytes(file);
  if (old && Buffer.compare(old, buf) === 0) return false;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
  return true;
}

// ---- the run's key -------------------------------------------------------------------------------------------------
const IMPORTS = /\bfrom\s*['"](\.\.?\/[^'"]+)['"]|\bimport\s*['"](\.\.?\/[^'"]+)['"]/g;
const DEPLOY_LOADS = /\bloadDeploy\(\s*['"]([^'"]+)['"]\s*\)/g;
let encoderCache = null;

/** { script, version, sha } — the same in the plugin tree and the project copy. */
export function encoderKey() {
  if (encoderCache) return encoderCache;
  const deployDir = dirname(deployPath('sanitise.js'));
  const nameOf = (abs) => {
    for (const [base, prefix] of [[SCRIPTS, ''], [deployDir, 'deploy/']]) {
      const rel = relative(base, abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return `${prefix}${rel.split(sep).join('/')}`;
    }
    return basename(abs);
  };
  const seen = new Map();
  const walk = (abs) => {
    if (seen.has(abs)) return;
    const src = readFileSync(abs, 'utf8');
    seen.set(abs, sha256(src));
    for (const m of src.matchAll(IMPORTS)) { const t = resolve(dirname(abs), m[1] || m[2]); if (existsSync(t)) walk(t); }
    for (const m of src.matchAll(DEPLOY_LOADS)) { let t = null; try { t = deployPath(m[1]); } catch { /* not a deploy file */ } if (t) walk(t); }
  };
  walk(join(SCRIPTS, 'encode.mjs'));
  const lines = [...seen].map(([abs, s]) => `${nameOf(abs)} ${s}`).sort(byCodePoint);
  encoderCache = { script: ENCODER_SCRIPT, version: ENCODER_VERSION, sha: sha256(lines.join('\n')) };
  return encoderCache;
}

/** { template, vocabularySha, transformSha } of stardust/import/<archetype>/. */
export function mapKey(root, archetype) {
  const dir = join(root, 'stardust', 'import', archetype);
  return { template: archetype, vocabularySha: jsonSha(readBytes(join(dir, 'vocabulary.json'))), transformSha: jsonSha(readBytes(join(dir, 'transform.json'))) };
}

// ---- one page's inputs ---------------------------------------------------------------------------------------------
export const patchPath = (slug) => `stardust/patches/${slug}.json`;
const bytesSha = (bytes) => (bytes === null ? null : sha256(bytes));
const captureSha = (root, slug) => (safeSlug(slug) ? bytesSha(readBytes(join(root, 'stardust', 'current', 'pages', `${slug}.html`))) : null);

/** The page's input key (no parse of the capture: shas only). */
export function pageInputs({ root, site, slug, archetype }) {
  const ok = safeSlug(slug);
  return {
    captureSha: captureSha(root, slug),
    pageJsonSha: ok ? jsonSha(readBytes(join(root, 'stardust', 'current', 'pages', `${slug}.json`))) : null,
    siteSha: site.siteSha,
    patchesSha: ok ? jsonSha(readBytes(join(root, patchPath(slug)))) : null,
    archetypeCaptureSha: slug === archetype ? null : captureSha(root, archetype),
  };
}

/** The page's patches for the engine: { value: array|null, error? } (absent → null; the engine validates the shape). */
export function readPatches(root, slug) {
  const b = safeSlug(slug) ? readBytes(join(root, patchPath(slug))) : null;
  if (b === null) return { value: null };
  try { return { value: JSON.parse(b.toString('utf8')) }; } catch (e) { return { value: null, error: `${patchPath(slug)}: invalid JSON (${e.message})` }; }
}

// ---- sidecar -------------------------------------------------------------------------------------------------------
export const sidecarPathFor = (url) => `${MIGRATED}/${sidecarFor(outputPathFor(url).outputPath)}`;

/** { value: object|null, error? } — a sidecar that exists but is not a JSON object is never overwritten. */
export function readSidecar(root, rel) {
  const b = readBytes(join(root, rel));
  if (b === null) return { value: null };
  let v = null;
  try { v = JSON.parse(b.toString('utf8')); } catch { /* reported below */ }
  if (!isObj(v)) return { value: null, error: `${rel} exists but is not a valid JSON sidecar — fix or delete it (its recorded judgments would be lost by overwriting), then re-run` };
  return { value: v };
}

/** The skip predicate (the caller checks --force). */
export function skipPage({ current, sidecar, docPath, docSha, manifestSha }) {
  const e = sidecar && sidecar.encode;
  if (!docSha || docSha !== manifestSha || !isObj(e) || !isObj(e.output)) return false;
  if (e.output.path !== docPath || e.output.sha !== docSha || sidecar.audit?.encode?.status !== 'clean') return false;
  return same({ encoder: e.encoder, map: e.map, inputs: e.inputs }, current);
}

/**
 * The hand-edit guard for a clean page's new bytes → { write, adopt?, overwrote? } or { handEdit: "<message>" }.
 * docSha null = no document; manifestSha undefined = the manifest does not list the path.
 */
export function guardPage({ docSha, manifestSha, newSha, overwrite, docPath, slug, archetype }) {
  if (docSha === null) return { write: true };
  if (docSha === newSha) return { write: false, adopt: manifestSha !== newSha };
  if (docSha === manifestSha) return { write: true };
  if (overwrite) return { write: true, overwrote: true };
  const manifest = manifestPathFor(archetype);
  const what = manifestSha ? `differs from the encoder's last write (sha ${short(docSha)}; ${manifest} records ${short(manifestSha)})` : `is not in ${manifest} and differs from the encode (sha ${short(docSha)}; the encode is ${short(newSha)})`;
  return { handEdit: `${docPath} ${what} — a hand edit: move it into stardust/patches/${slug}.json or the map (stardust/import/${archetype}/vocabulary.json) and re-run; --overwrite-hand-edit ${slug} discards it` };
}

/** The sidecar's `encode` for a clean encode; encodedAt is kept while the output bytes stay. */
export function encodeKeyOf({ current, docPath, outSha, old, now }) {
  const prev = isObj(old?.encode) ? old.encode : null;
  const keep = prev && isObj(prev.output) && prev.output.path === docPath && prev.output.sha === outSha && typeof prev.encodedAt === 'string';
  return { encoder: current.encoder, map: current.map, inputs: current.inputs, output: { path: docPath, sha: outSha }, encodedAt: keep ? prev.encodedAt : now() };
}

/**
 * The page's sidecar with this run's keys: `audit.encode` always, `encode` when given (a stop keeps the old one). An
 * existing sidecar keeps every other key and its key order; a missing one is created migrate-shaped.
 */
export function sidecarWith(old, { slug, role, archetype, type = null, url, encode, audit }) {
  if (old) {
    const next = { ...old };
    if (encode !== undefined) next.encode = encode;
    next.audit = { ...(isObj(old.audit) ? old.audit : {}), encode: audit };
    return next;
  }
  const { outputPath, outputPathDefault } = outputPathFor(url);
  const sibling = role !== 'archetype';
  const base = {
    slug, type, renderBranch: sibling ? "A'" : 'A', template: sibling ? archetype : null, modules: [], migrationDecisions: [],
    fidelityTier: sibling ? 'sibling' : 'archetype', archetypeSource: sibling ? archetype : null,
    variants: [], gatesPassed: [], gateEvidence: {}, contentDeviations: [], deviations: [],
    outputPath, outputPathDefault, sidecar: sidecarFor(outputPath), encode: encode ?? null, audit: { encode: audit },
  };
  return Object.fromEntries(SIDECAR_KEYS.map((k) => [k, base[k] ?? null]));
}

/** Write the sidecar when its content changed (a semantically equal sidecar is left as its owner formatted it). */
export function saveSidecar(root, rel, old, next) {
  if (old && same(old, next)) return false;
  return writeIfChanged(join(root, rel), pretty(next));
}

// ---- manifest ------------------------------------------------------------------------------------------------------
export const manifestPathFor = (archetype) => `stardust/import/${archetype}/manifest.json`;

/** The manifest as {docPath: sha}; {} when absent. A malformed one throws: the guard cannot run without it. */
export function readManifest(root, archetype) {
  const rel = manifestPathFor(archetype);
  const b = readBytes(join(root, rel));
  if (b === null) return {};
  let v;
  try { v = JSON.parse(b.toString('utf8')); } catch (e) { throw new Error(`${rel}: invalid JSON (${e.message}) — repair it, or remove it so every encoded document counts as unlisted (byte-equal ones are adopted)`); }
  if (!isObj(v)) throw new Error(`${rel}: not a JSON object`);
  return v;
}

/** Re-read the manifest, lay `updates` (Map docPath → sha) over it, write it when its bytes change. */
export function saveManifest(root, archetype, updates) {
  if (!updates.size) return false;
  const m = readManifest(root, archetype);
  for (const [k, v] of updates) m[k] = v;
  return writeIfChanged(join(root, manifestPathFor(archetype)), pretty(Object.fromEntries(Object.keys(m).sort(byCodePoint).map((k) => [k, m[k]]))));
}

// ---- state.json ----------------------------------------------------------------------------------------------------
function readState(root) {
  const b = readBytes(join(root, 'stardust', 'state.json'));
  if (b === null) return null;
  try { return JSON.parse(b.toString('utf8')); } catch (e) { throw new Error(`stardust/state.json: invalid JSON (${e.message})`); }
}

/** slug → the state page's type (null when unknown); {} without state.json. */
export function stateTypes(root) {
  const s = readState(root);
  return new Map((Array.isArray(s?.pages) ? s.pages : []).filter((p) => isObj(p) && typeof p.slug === 'string').map((p) => [p.slug, p.type ?? null]));
}

/** Merge state.json.migrate.generators[<archetype>] = value; true when written. */
export function saveGenerators(root, archetype, value) {
  const s = readState(root);
  if (!isObj(s)) return false;
  const mig = isObj(s.migrate) ? s.migrate : {};
  const gens = isObj(mig.generators) ? mig.generators : {};
  if (same(gens[archetype], value)) return false;
  s.migrate = { ...mig, generators: { ...gens, [archetype]: value } };
  return writeIfChanged(join(root, 'stardust', 'state.json'), pretty(s));
}
