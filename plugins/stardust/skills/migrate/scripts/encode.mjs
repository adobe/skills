#!/usr/bin/env node
/**
 * migrate/encode.mjs — the shipped sibling encoder: a template's authored map applied to each page's committed capture,
 * written in deploy's delivered form. Turns a rendered capture (stardust/current/pages/<slug>.html) into the delivered
 * document for a template's siblings WITHOUT a hand-written parser: the project authors the map
 * (stardust/import/<archetype>/vocabulary.json — what each source module is and how it becomes rows × cells — and
 * transform.json — rich-text rules) from the gated archetype; this script does the walk. Seven field migrations wrote
 * this importer by hand; the regex variants swallowed component runs, the descendant-matching ones flattened modules to
 * prose. `migrate` never decides content — except here, where the decision is the template's authored map.
 *
 * Runtime: a built-in HTML parser + CSS-selector matcher (encode/dom.mjs). Browser-serialised captures are regular HTML,
 * so no browser is launched and NO network request can happen; the plugin keeps zero runtime dependencies.
 *
 * Usage:
 *   node skills/migrate/scripts/encode.mjs --template <archetype-slug> [--slug <s>[,<s>…]] [--root <projectDir>]
 *        [--dry-run] [--json] [--force] [--overwrite-hand-edit <slug>[,…]]
 *   node skills/migrate/scripts/encode.mjs --roundtrip --template <archetype-slug> [--level text|strict] [--root <dir>]
 *   node skills/migrate/scripts/encode.mjs --lint|--sweep --template <archetype-slug> [--root <dir>] [--json]
 *
 * Reads (never the row-2 clone, never content/ except --roundtrip): the map under stardust/import/<archetype>/, the
 * roster (stardust/rollout/coverage/templates.json), each page's capture + page JSON under stardust/current/pages/,
 * stardust/patches/<slug>.json (the page's patches), deploy/media-ledger.json (sources → contentUrl),
 * deploy/asset-ledger.json, rollout/chrome-map.json, redirects.tsv.
 * Writes (encode/provenance.mjs has the shapes) — each file only when its bytes change, tmp + rename; nothing with
 * --dry-run, --roundtrip, --lint or --sweep; zero writes when nothing changed:
 *   stardust/encoded/<da-path>.html             the document (the root page: index.html)
 *   stardust/migrated/…/<name>._meta.json       migrate's sidecar for the page: `encode` (the provenance of the document
 *                                               on disk) and `audit.encode` (this run's status and report; a clean
 *                                               page's `shape` — encode/shape.mjs, C14) — no other key; created
 *                                               migrate-shaped when the page has none
 *   stardust/import/<archetype>/manifest.json   each document path → the sha256 the encoder wrote there
 *   stardust/state.json                         migrate.generators[<archetype>] only (never created)
 *
 * Per page: the walk + grammar (encode/engine.mjs), media from the ledger, documents from the asset ledger, internal
 * links localised, nav/footer from the chrome map, the shape fingerprint against the archetype's (computed from the
 * archetype's capture in the same run), the offline content count (deploy's content-inventory.mjs), then sanitise's
 * encode() last — the output is finalisation-idempotent; a clean page's block shape (encode/shape.mjs: blocks with
 * their variants, row counts and cell kinds) goes to audit.encode.shape, which decides whether a sibling inherits the
 * archetype's local harness launches (C14). Page status: clean · unmapped · flattened · variance
 * (accept a reviewed print in vocabulary.json `variance.accept[]`) · incomplete (fix the map or declare a `drop:`) ·
 * hand-edit (the document on disk is not the encoder's last write: move the edit into stardust/patches/<slug>.json or
 * the map) · error. A stopped page's document is never written — an earlier one stays, its sidecar records the stop
 * and staging skips it; the model handles that page as an exception. Unchanged inputs, map, encoder and document
 * skip the page (`unchanged`, nothing parsed).
 *   --roundtrip  encode the archetype in memory and compare it with its gated content/<da-path>.html (encode/compare.mjs;
 *                level text by default) — exit 0 equal, 2 not.
 *   --lint/--sweep  the map's authoring checks (encode/lint.mjs).
 *   --json       line 1: the run summary as one JSON object; the verdict line stays last.
 *   --force      re-encode a page the skip would pass over (the byte gate still decides each write); never overrides
 *                the hand-edit guard.
 *   --overwrite-hand-edit <slug…>  replace these pages' hand-edited documents with the encode — never passed in
 *                hands-off: the edit moves into stardust/patches/<slug>.json or the map first.
 *
 * Output: one line per page (or finding), then the verdict line (stdout, last), and the exit code, per mode:
 *   encode       `encoded N · unchanged N · stopped N` — 0 every page encoded or unchanged · 1 usage, invalid
 *                map/transform, missing input · 2 any page stopped (2 wins over 1). Exit 0 means "encoded", never
 *                "done": the gates still decide.
 *   --roundtrip  `roundtrip <archetype> at <level>: equal | not equal (N differences) — <content file>` — 0 equal ·
 *                2 not equal; `roundtrip <archetype>: no (the archetype stops: <status>)` — 2; no gated document —
 *                one stderr line, no verdict, 1 (as for usage)
 *   --lint       `lint <archetype>: N findings · N notes` — 0 no finding · 1 any finding (an invalid map included)
 *   --sweep      `sweep <archetype>: N siblings · new kinds N · unknown modifiers N · zero-hit markers N` — 0 nothing
 *                listed · 2 something listed · 1 usage, an invalid map or no usable archetype
 *
 * Ported from the `stardust/next` branch: `skills/migrate/scripts/importer-skeleton.mjs` (commits 9aaeff4f, d4a37277, 7662fda2).
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as engine from './encode/engine.mjs';
import * as dom from './encode/dom.mjs';
import { loadSite } from './encode/site.mjs';
import { loadDeploy } from './encode/deps.mjs';
import * as prov from './encode/provenance.mjs';
import { shapeOf } from './encode/shape.mjs';

const USAGE = `Usage:
  node skills/migrate/scripts/encode.mjs --template <archetype-slug> [--slug <s>[,<s>…]] [--root <projectDir>]
       [--dry-run] [--json] [--force] [--overwrite-hand-edit <slug>[,…]]
  node skills/migrate/scripts/encode.mjs --roundtrip --template <archetype-slug> [--level text|strict] [--root <dir>]
  node skills/migrate/scripts/encode.mjs --lint|--sweep --template <archetype-slug> [--root <dir>] [--json]

Applies the template's map (stardust/import/<archetype>/vocabulary.json + transform.json) to each page's committed
capture and writes stardust/encoded/<da-path>.html in deploy's delivered form (sanitised; written only when the bytes
change), with provenance in the page's migrate sidecar (encode, audit.encode) and stardust/import/<archetype>/
manifest.json. A page that stops (unmapped · flattened · variance · incomplete · hand-edit · error) is not written.
  --force      re-encode pages whose inputs, map and document are unchanged (never overrides the hand-edit guard)
  --overwrite-hand-edit <slug>[,…]  replace these hand-edited documents (never in hands-off: move the edit into
               stardust/patches/<slug>.json or the map first)
  --roundtrip  encode the archetype in memory, compare with its gated content/<da-path>.html (exit 0 equal, 2 not)
  --lint       the map's authoring checks · --sweep  a dry run over every sibling capture (both write nothing)
  --json       line 1 = the run summary as JSON; the verdict line stays last
Verdict (last line) · exit, per mode:
  encode       encoded N · unchanged N · stopped N
               0 encoded/unchanged · 1 usage, invalid map/transform, missing input · 2 a page stopped (2 wins over 1)
  --roundtrip  roundtrip <archetype> at <level>: equal | not equal (N differences) — <content file>
               0 equal · 2 not equal
               roundtrip <archetype>: no (the archetype stops: <status>) — 2
               no gated document: one stderr line, no verdict — 1 (as for usage)
  --lint       lint <archetype>: N findings · N notes
               0 no finding · 1 any finding (an invalid map included)
  --sweep      sweep <archetype>: N siblings · new kinds N · unknown modifiers N · zero-hit markers N
               0 nothing listed · 2 something listed · 1 usage, an invalid map or no usable archetype`;

const LEVELS = ['core', 'text', 'strict', 'byte'];
class UsageError extends Error {}

export function parseArgs(argv) {
  const a = { help: false, template: null, slugs: null, root: '.', dryRun: false, json: false, force: false, overwriteHandEdit: [], roundtrip: false, level: 'text', lint: false, sweep: false };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new UsageError(`${k} needs a value`); i += 1; return v; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--template') a.template = next();
    else if (k === '--slug') a.slugs = [...(a.slugs || []), ...list(next())];
    else if (k === '--root') a.root = next();
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--json') a.json = true;
    else if (k === '--force') a.force = true;
    else if (k === '--overwrite-hand-edit') a.overwriteHandEdit.push(...list(next()));
    else if (k === '--roundtrip') a.roundtrip = true;
    else if (k === '--level') { a.level = next(); if (!LEVELS.includes(a.level)) throw new UsageError(`--level ${a.level}: use text or strict (or core, byte)`); }
    else if (k === '--lint') a.lint = true;
    else if (k === '--sweep') a.sweep = true;
    else throw new UsageError(`unknown flag ${k}`);
  }
  if (a.help) return a;
  if (!a.template) throw new UsageError('--template <archetype-slug> is required');
  if ([a.roundtrip, a.lint, a.sweep].filter(Boolean).length > 1) throw new UsageError('--roundtrip, --lint and --sweep are exclusive');
  return a;
}

const readJSONFile = (file) => { try { return { value: JSON.parse(readFileSync(file, 'utf8')) }; } catch (e) { return { error: e.code === 'ENOENT' ? 'missing' : `invalid JSON (${e.message})` }; } };

/** The template's map: { vocab, tf, vocabFile, transformFile, errors[] } (paths absolute; transform.json optional). */
export function loadMap(root, archetype) {
  const dir = join(root, 'stardust', 'import', archetype);
  const vocabFile = join(dir, 'vocabulary.json'); const transformFile = join(dir, 'transform.json');
  const errors = [];
  const v = readJSONFile(vocabFile);
  if (v.error) errors.push(`stardust/import/${archetype}/vocabulary.json ${v.error} — author the map from the gated archetype first`);
  const t = existsSync(transformFile) ? readJSONFile(transformFile) : { value: {} };
  if (t.error) errors.push(`stardust/import/${archetype}/transform.json ${t.error}`);
  if (!v.error) errors.push(...engine.validateVocabulary(v.value).map((e) => `vocabulary.json: ${e}`));
  if (!t.error) errors.push(...engine.validateTransform(t.value).map((e) => `transform.json: ${e}`));
  return { vocab: v.value ?? null, tf: t.value ?? null, vocabFile, transformFile, errors };
}

/** deploy's finaliser, offline content count and file writer (chrome-map.mjs: writeIfChanged, stableJSON), in either layout. */
export async function loadEncoderDeps() {
  const sanitise = await loadDeploy('sanitise.js');
  const inventory = await loadDeploy('content-inventory.mjs');
  const eds = await loadDeploy('eds-path.mjs');
  const files = await loadDeploy('chrome-map.mjs');
  if (typeof sanitise.encode !== 'function') throw new UsageError('deploy/sanitise.js exports no encode() — update the project copy of the deploy scripts');
  if (typeof inventory.offlineInventory !== 'function' || typeof inventory.diffOffline !== 'function') throw new UsageError('deploy/content-inventory.mjs has no offlineInventory/diffOffline — update the project copy of the deploy scripts');
  if (typeof files.writeIfChanged !== 'function' || typeof files.stableJSON !== 'function') throw new UsageError('deploy/chrome-map.mjs has no writeIfChanged/stableJSON — update the project copy of the deploy scripts');
  return { finalise: (s) => sanitise.encode(s).output, inventory, pathKey: eds.pathKey, writeIfChanged: files.writeIfChanged, stableJSON: files.stableJSON };
}

// the content count's identities: media by the ledger's contentUrl, internal links by their localised path
function countKeysFor(site, base, pathKey) {
  return {
    mediaKey: (abs) => site.resolveMedia(abs),
    linkKey: (abs) => {
      const r = site.localizeHref(abs, base);
      if (!r.internal || r.kind === 'doc') return null;
      const u = new URL(r.href, 'https://doc.invalid/');
      return `${pathKey(u.pathname)}${u.search}`;
    },
  };
}

/**
 * Encode one page in memory (nothing is written): its capture, page JSON and patches through the engine.
 * → { slug, role, status, output, html, report (+ shape when clean), prints, blocks, missingInput? }.
 */
export function encodeOne({ root, site, map, deps, slug, archetype, archetypePrints = null }) {
  const role = slug === archetype ? 'archetype' : 'sibling';
  const info = site.page(slug);
  const stop = (msg, missingInput = true) => ({ slug, role, status: 'error', output: info ? info.outputPath : null, html: null, prints: [], ...(missingInput ? { missingInput } : {}), report: { errors: [msg] } });
  if (!info) return stop(`no source URL for ${slug} (its page JSON url, or state.json pages[].url)`);
  const capFile = join(root, info.capturePath);
  if (!existsSync(capFile)) return stop(`no capture ${info.capturePath} — run extract; the encoder never fetches the live page`);
  const patches = prov.readPatches(root, slug);
  if (patches.error) return stop(patches.error, false);
  // a patch file must hold an array: JSON null (or any other non-array) is malformed, never "no patches"
  if (patches.present && !Array.isArray(patches.value)) return stop(`${prov.patchPath(slug)}: ${engine.validatePatches(patches.value).join('; ')}`, false);
  const page = { ...(site.pageJson(slug) || {}), url: info.url };
  const base = site.baseUrlFor(slug) || info.url; // relative URLs in the capture resolve where it was captured (R15)
  const res = engine.encodePage({ html: readFileSync(capFile, 'utf8'), page, base, vocab: map.vocab, tf: map.tf, site, archetypePrints, inventory: deps.inventory, countKeys: countKeysFor(site, base, deps.pathKey), patches: patches.value, finalise: deps.finalise });
  const report = res.status === 'clean' ? { ...res.report, shape: shapeOf(res.html) } : res.report;
  return { slug, role, status: res.status, output: info.outputPath, html: res.html, report, prints: res.prints, blocks: res.blocks };
}

/**
 * Encode the template's pages in memory (nothing is written, nothing skipped). The archetype is always encoded first:
 * its print set is the reference every sibling's fingerprint is checked against. Returns { template, archetype,
 * records[] } with one record per selected page (encodeOne's shape).
 */
export async function encodeTemplate({ root, site, template, map, deps, slugs = null }) {
  const one = (slug, archetypePrints) => encodeOne({ root, site, map, deps, slug, archetype: template.archetype, archetypePrints });
  const arch = one(template.archetype, null);
  // without the archetype's capture there is no reference print set: the whole run is missing input
  if (arch.missingInput) throw new UsageError(`archetype ${template.archetype}: ${arch.report.errors[0]}`);
  const order = [template.archetype, ...template.pages.filter((s) => s !== template.archetype)];
  const selected = slugs ? order.filter((s) => slugs.includes(s)) : order;
  const records = selected.map((s) => (s === template.archetype ? arch : one(s, arch.prints)));
  return { template, archetype: arch, records };
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Encode and place the template's pages with provenance (encode/provenance.mjs): per page the skip predicate, else the
 * encode, then — clean — the hand-edit guard, the document, the sidecar's encode + audit.encode, or — stopped — the stop
 * in audit.encode; at the end the manifest and state.json.migrate.generators. Nothing is written with dryRun.
 * Returns the records (encodeOne's shape + write: 'encoded'|'unchanged', skipped, adopted, overwrote, handEdit, kept).
 */
export function placeTemplate({ root, site, template, map, deps, slugs = null, force = false, overwrite = [], dryRun = false, now = nowIso }) {
  const { archetype } = template;
  const key = { encoder: prov.encoderKey(), map: prov.mapKey(root, archetype) };
  const manifest = prov.readManifest(root, archetype);
  const types = prov.stateTypes(root);
  const order = [archetype, ...template.pages.filter((s) => s !== archetype)];
  const selected = slugs ? order.filter((s) => slugs.includes(s)) : order;
  // the archetype is encoded only when a page needs it: as itself, or for a sibling's reference prints
  let arch = null;
  const archetypeRecord = () => {
    if (!arch) arch = encodeOne({ root, site, map, deps, slug: archetype, archetype });
    if (arch.missingInput) throw new UsageError(`archetype ${archetype}: ${arch.report.errors[0]}`);
    return arch;
  };
  const records = []; const updates = new Map();
  for (const slug of selected) {
    const role = slug === archetype ? 'archetype' : 'sibling';
    const info = site.page(slug);
    if (!info) { records.push(encodeOne({ root, site, map, deps, slug, archetype })); continue; }
    const docPath = info.outputPath; const sideRel = prov.sidecarPathFor(info.url);
    const side = prov.readSidecar(root, sideRel);
    if (side.error) { records.push({ slug, role, status: 'error', output: docPath, html: null, prints: [], report: { errors: [side.error] } }); continue; }
    const docBytes = prov.readBytes(join(root, docPath));
    const docSha = docBytes === null ? null : prov.sha256(docBytes);
    const current = { ...key, inputs: prov.pageInputs({ root, site, slug, archetype }) };
    if (!force && prov.skipPage({ current, sidecar: side.value, docPath, docSha, manifestSha: manifest[docPath] })) {
      const { status, ...report } = side.value.audit.encode;
      records.push({ slug, role, status, output: docPath, html: null, prints: [], report, write: 'unchanged', skipped: true });
      continue;
    }
    const r = role === 'archetype' ? archetypeRecord() : encodeOne({ root, site, map, deps, slug, archetype, archetypePrints: archetypeRecord().prints });
    records.push(r);
    const sidecar = (encode) => prov.sidecarWith(side.value, { slug, role, archetype, type: types.get(slug) ?? null, url: info.url, encode, audit: { status: r.status, ...r.report }, blocks: r.blocks });
    if (r.status !== 'clean') {
      // a stop leaves the document (and `encode`) as they are; the sidecar says the page is not current
      r.kept = docBytes !== null;
      if (!dryRun && (side.value || r.kept)) prov.saveSidecar(deps, root, sideRel, side.value, sidecar(undefined));
      continue;
    }
    const outSha = prov.sha256(r.html);
    const g = prov.guardPage({ docSha, manifestSha: manifest[docPath], newSha: outSha, overwrite: overwrite.includes(slug), docPath, slug, archetype });
    if (g.handEdit) { r.status = 'hand-edit'; r.handEdit = g.handEdit; continue; }
    Object.assign(r, { write: g.write ? 'encoded' : 'unchanged', adopted: Boolean(g.adopt), overwrote: Boolean(g.overwrote) });
    if (manifest[docPath] !== outSha) updates.set(docPath, outSha);
    if (dryRun) continue;
    if (g.write) deps.writeIfChanged(join(root, docPath), r.html);
    prov.saveSidecar(deps, root, sideRel, side.value, sidecar(prov.encodeKeyOf({ current, docPath, outSha, old: side.value, now })));
  }
  if (!dryRun) {
    prov.saveManifest(deps, root, archetype, updates);
    prov.saveGenerators(deps, root, archetype, { script: key.encoder.script, sha: key.encoder.sha, version: key.encoder.version, vocabularySha: key.map.vocabularySha, transformSha: key.map.transformSha });
  }
  return records;
}

function findings(r) {
  const rep = r.report; const out = [];
  if (r.handEdit) out.push(`hand-edit ${r.handEdit}`);
  for (const e of rep.errors || []) out.push(`error ${e}`);
  for (const u of rep.unmapped || []) out.push(`unmapped ${u.kind} at ${u.at} — ${u.remedy || 'map it, or drop:<reason> in vocabulary.json'}`);
  for (const f of rep.flattened || []) out.push(`flattened ${f.kind} at ${f.at}: ${(f.why || []).join('; ')}`);
  for (const v of rep.variance || []) out.push(`variance ${v.change} ${v.print}`);
  for (const m of rep.incomplete || []) out.push(`incomplete MISSING ${m.role} "${String(m.text || m.key).slice(0, 80)}"${m.reason ? ` (${m.reason})` : ''}`);
  if (r.kept) out.push(`${r.output} (an earlier encode) is kept, not current — staging skips it until the page encodes clean`);
  return out;
}
const summaryOf = (r) => ({ slug: r.slug, role: r.role, status: r.status, write: r.write || null, output: r.output, ...(r.skipped ? { skipped: true } : {}), ...(r.adopted ? { adopted: true } : {}), ...(r.overwrote ? { overwrote: true } : {}), ...(r.handEdit ? { handEdit: r.handEdit } : {}), ...(r.kept ? { kept: true } : {}), ...(r.missingInput ? { missingInput: true } : {}), report: r.report });
const wroteNote = (r, a) => {
  if (r.write !== 'encoded') return r.adopted ? `unchanged; adopted into ${prov.manifestPathFor(a.template)}` : 'unchanged';
  return `${a.dryRun ? 'would write' : 'written'}${r.overwrote ? '; the hand edit is overwritten' : ''}`;
};

async function runEncode(a, { root, site, template, map, deps }, io) {
  const records = placeTemplate({ root, site, template, map, deps, slugs: a.slugs, force: a.force, overwrite: a.overwriteHandEdit, dryRun: a.dryRun });
  const counts = { encoded: 0, unchanged: 0, stopped: 0 };
  for (const r of records) counts[r.status === 'clean' ? r.write : 'stopped'] += 1;
  if (a.json) io.out(JSON.stringify({ template: template.archetype, templateId: template.id, dryRun: a.dryRun, counts, pages: records.map(summaryOf) }));
  else {
    for (const r of records) {
      if (r.status === 'clean') io.out(`${r.write === 'encoded' ? '✓' : '·'} ${r.slug} clean → ${r.output} (${wroteNote(r, { template: template.archetype, dryRun: a.dryRun })})`);
      else { io.out(`✗ ${r.slug} ${r.status}`); for (const f of findings(r)) io.out(`    ${f}`); }
    }
    if (a.dryRun) io.out('dry run: nothing written');
  }
  io.out(`encoded ${counts.encoded} · unchanged ${counts.unchanged} · stopped ${counts.stopped}`);
  const stopped = records.some((r) => r.status !== 'clean' && !r.missingInput);
  return stopped ? 2 : records.some((r) => r.missingInput) ? 1 : 0;
}

async function runRoundtrip(a, { root, site, template, map, deps }, io) {
  const { archetype: r } = await encodeTemplate({ root, site, template, map, deps, slugs: [template.archetype] });
  const contentRel = site.contentFileFor(template.archetype);
  if (!contentRel) { io.err(`encode: no gated document ${site.contentPathFor(template.archetype)} — the round-trip compares the archetype with its delivered document`); return 1; }
  const contentFile = join(root, contentRel);
  if (r.status !== 'clean') { io.out(`✗ ${r.slug} ${r.status}`); for (const f of findings(r)) io.out(`    ${f}`); io.out(`roundtrip ${template.archetype}: no (the archetype stops: ${r.status})`); return 2; }
  const { compareDocs } = await import('./encode/compare.mjs');
  const cmp = compareDocs(readFileSync(contentFile, 'utf8'), r.html, { level: a.level });
  if (a.json) io.out(JSON.stringify({ template: template.archetype, level: a.level, equal: cmp.equal, diffs: cmp.diffs }));
  else for (const d of cmp.diffs) io.out(`    ${d.kind} ${d.where}\n      expected: ${JSON.stringify(d.expected)}\n      got:      ${JSON.stringify(d.got)}`);
  io.out(`roundtrip ${template.archetype} at ${a.level}: ${cmp.equal ? 'equal' : `not equal (${cmp.diffs.length} differences)`} — ${contentRel}`);
  return cmp.equal ? 0 : 2;
}

export async function main(argv = process.argv.slice(2), io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  let a;
  try { a = parseArgs(argv); } catch (e) { io.err(`encode: ${e.message}\n${USAGE}`); return 1; }
  if (a.help) { io.out(USAGE); return 0; }
  const root = resolve(a.root);
  try {
    const site = await loadSite(root);
    const template = site.templateOf(a.template);
    if (!template) throw new UsageError(`no template with archetype (or id) "${a.template}" in stardust/rollout/coverage/templates.json`);
    if (a.slugs) { const stray = a.slugs.filter((s) => !template.pages.includes(s)); if (stray.length) throw new UsageError(`--slug ${stray.join(',')}: not a page of template ${template.archetype}`); }
    { const stray = a.overwriteHandEdit.filter((s) => !template.pages.includes(s)); if (stray.length) throw new UsageError(`--overwrite-hand-edit ${stray.join(',')}: not a page of template ${template.archetype}`); }
    const map = loadMap(root, template.archetype);
    if (a.lint || a.sweep) {
      if (!map.vocab) throw new UsageError(map.errors.join('\n  '));
      const lint = await import('./encode/lint.mjs');
      const readCapture = (slug) => { const p = site.capturePath(slug); return p && existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null; };
      const ctx = { root, template, vocab: map.vocab, tf: map.tf || {}, vocabFile: map.vocabFile, transformFile: map.transformFile, mapErrors: map.errors, site, engine, dom, loadDeploy, readCapture, encodeTemplate, loadEncoderDeps, json: a.json, out: io.out, err: io.err };
      return await (a.lint ? lint.runLint(ctx) : lint.runSweep(ctx));
    }
    if (map.errors.length) throw new UsageError(`invalid map for ${template.archetype}:\n  ${map.errors.join('\n  ')}`);
    const deps = await loadEncoderDeps();
    const env = { root, site, template, map, deps };
    return await (a.roundtrip ? runRoundtrip(a, env, io) : runEncode(a, env, io));
  } catch (e) {
    io.err(`encode: ${e.message}`);
    return 1;
  }
}

const isMain = (() => { try { return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().then((code) => { process.exitCode = code; });
