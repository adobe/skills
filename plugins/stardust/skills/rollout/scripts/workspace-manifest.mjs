#!/usr/bin/env node
/**
 * rollout/workspace-manifest.mjs — hashes, placeholders and handover state for the coverage a client reads (the
 * migration export: required when rollout.json `exports` lists `migration-workspace`).
 *
 * Usage: node skills/rollout/scripts/workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--captures <dir>] [--allow-no-mapping] [--check] [--rehash-only] [--draft-judgement] [--force] [--dry-run] [--json]
 *   defaults: --out stardust/rollout  --project .  --content <project>/content  --blocks <project>/blocks
 *             --captures <project>/stardust/current/pages
 *
 * The export, in order: inventory.mjs + blocks.mjs, block-origin.mjs --verify (→ <out>/workspace/mapping.json),
 * then this script. When the captures dir holds a capture (<slug>.html or <slug>.json) and mapping.json is absent,
 * the manifest is written WITHOUT `handover` (not ready to hand over), `missing: <out>/workspace/mapping.json — run
 * block-origin.mjs --verify first` goes to stderr and the exit is 2; --allow-no-mapping writes it as before
 * (handover null, exit 0). A project without captures needs no mapping.
 *
 * The coverage (<out>/coverage/{pages,templates,blocks}.json with formatVersion, written by
 * inventory.mjs and blocks.mjs) is what a client reads; reference/coverage-contract.md documents
 * it. This script writes <out>/workspace/manifest.json beside it: the hashes of the coverage files
 * and of <out>/workspace/mapping.json when present (outputs) and of what the coverage was built
 * from (inputs: every <content>/**.html as one entry, each <blocks>/<name>/<name>.{js,css},
 * <out>/workspace/judgement.json when present), placeholders
 * (fields not judged, pages without a content file, module blocks delivered without a conversion record — instances
 * in the content files, no update-coverage.mjs --block record), a `templateGroups` {total, archetypes, siblings} count
 * split (siblings = the cloned sibling template groups beyond one archetype per page type), a `variantsSummary`
 * {total, singleUse, blocks} recomputed from blocks.json's module rows (the variants, those a single instance uses —
 * each a catalog block for an adopter — and the blocks with any), a `selectorQuality` block derived from mapping.json
 * when present (block-origin's countsOf: the selector sources, encoderCoverage, the zeroConfidence count, the
 * lowConfidence count — verified selectors at 0 < confidence < 0.5, whose element holds a minority of the block's
 * text — and byTemplate,
 * the same split per template, each row with the template's encode decision `encode {decision, reason, vocabulary,
 * recordedAt}` read from migrate's record <project>/stardust/migrate/encode/<template>.json — never written here —
 * and `selectorQuality.encode` counting the decisions), a `sectionGaps` list derived from mapping.json the same way
 * (the sections with no source selector — what a client projecting per selector cannot emit; the export states its
 * own properties, never a client's merge), a
 * `judgement` {toFill, byKind} derived from judgement.json (its own toFill[] fields still empty, by field), an
 * `excluded` [{url, reason}] list of the planned URLs that never became a page (the coverage's excluded[] rows, the
 * crawl's failed URLs in <stardust>/current/_crawl-log.json, state.json pages[] and plan.json steps with no pages[]
 * row; `unrecorded` when nothing says why; [] when every planned URL is a page) — none a
 * rewrite of its source, so a re-hash recomputes them and --check never counts them as drift, the handover state and
 * `handoverNotes` (owner
 * actions: present only when non-empty, e.g. delivered blocks with no judged base type — unknown is not a judged
 * value, the owner names them; the section-gap counts). It refuses (exit 1,
 * nothing written, --force included) coverage without formatVersion and stale coverage: a content
 * file whose hash is not its page's delivered.contentHash (re-run inventory.mjs and blocks.mjs), or
 * a file blocks.json records in _provenance.inputs that changed or is gone, a judgement.json it did
 * not read, or no such record at all (re-run blocks.mjs). Unchanged inputs give a byte-identical
 * manifest, and then nothing is rewritten ("unchanged"); a write goes to a temp file renamed into
 * place.
 *
 * --check (read-only) classifies drift between the last manifest and the files on disk, so a stale
 * export gets the cheapest safe refresh. `fresh` nothing drifted (exit 0); `rehash-safe` only inputs
 * that cannot change the mapping or the page/template/block set drifted — a block's CSS, or a coverage
 * file regenerated with the same page and block set (only generatedAt moved) — so a re-hash suffices
 * (exit 5); `rebuild` the content summary, a capture, an eds-schema sidecar, an encoder map, a block's
 * JS or the judgement changed, or mapping.json itself — anything feeding selectors or templates — so
 * the full sequence is needed (exit 4). It prints the classification, the drifted inputs and the exact
 * next command; when coverage/pages.json drifted it also notes the adopter refuses the export until it
 * is refreshed. --rehash-only is allowed only when --check is rehash-safe (or already fresh): it
 * refreshes the manifest's input and output hashes (and reconciles mapping.json's generatedAt to
 * pages.json's — the only field block-origin would move when its own inputs are unchanged), keeping
 * every other field byte-identical, and refuses with the rebuild command (exit 4) otherwise. Idempotent:
 * a second run is byte-identical, "unchanged". 5/4 are used in place of a 3 that `handed over` holds.
 *
 * --draft-judgement writes only <out>/workspace/judgement.json, and only when it is absent; it needs
 * the three coverage files with formatVersion, fresh or not. Every field to judge is empty (toFill
 * lists them) and counts as judged once non-empty; blocks.mjs and inventory.mjs carry judged values
 * into coverage. `defaults` are suggestions: a template name or description left empty stays absent
 * in coverage (clients fall back to the template's type), an empty base type keeps the coverage
 * default. colorScheme is optional: its empty field is there to fill, but it is neither in toFill
 * nor a placeholder. --dry-run computes and prints what would be written, writing nothing. --json
 * prints one JSON object (`missing` lists what the export lacks: [] or [<mapping.json>]).
 *
 * Handover: when <out>/workspace/handover.json exists (a client that adopted the project writes
 * it; this script never does), the last manifest records a handover, or the content the last
 * manifest recorded as tracked by git is no longer tracked, it writes nothing and exits 3.
 * --force writes the manifest anyway, records the handover (a later forced run keeps it) and marks
 * it degraded with the inputs that differ from the last manifest before it.
 *
 * Exit 0 written or unchanged, 1 coverage missing, without formatVersion, stale or unreadable,
 * 2 usage, or mapping.json missing while captures exist (the manifest written or unchanged without handover —
 * a handover a forced run recorded is kept; the `missing:` line on stderr tells it from a usage error),
 * 3 handed over. --check: 0 fresh, 5 rehash-safe, 4 rebuild. --rehash-only: 0 rehashed or unchanged, 4 rebuild.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readJSON, sha256, byStr, kebab, edsName, kindOf, DEFAULT_CONTENT, contentFileFor, identityTokens, scrubIdentity,
  COVERAGE_FORMAT_VERSION, classifyExportDrift, urlToDeliveredPath, variantsSummaryOf,
} from './lib.mjs';
// countsOf derives the selector-quality figures from mapping.json; importing it runs nothing (its CLI is isMain-guarded).
import { countsOf } from './block-origin.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

export const FORMAT_VERSION = '0.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const WRITTEN_BY = 'stardust:rollout/workspace-manifest';
const FILES = { manifest: 'manifest.json', judgement: 'judgement.json', handover: 'handover.json', mapping: 'mapping.json' };
const COVERAGE = ['pages', 'templates', 'blocks'];
// The standard base types a delivered block can be judged as — the candidate list the draft offers for an unjudged one
// (`unknown` is not among them: it is not a judged value, it is the absence of one).
const BASE_TYPE_CANDIDATES = ['accordion', 'breadcrumbs', 'cards', 'carousel', 'columns', 'embed', 'form', 'fragment', 'hero', 'modal', 'quote', 'search', 'table', 'tabs', 'video'];
const VALUE_FLAGS = ['out', 'project', 'content', 'blocks', 'captures'];
const BOOL_FLAGS = ['draft-judgement', 'force', 'dry-run', 'json', 'allow-no-mapping', 'check', 'rehash-only'];
const USAGE = 'usage: workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--captures <dir>] [--allow-no-mapping] [--check] [--rehash-only] [--draft-judgement] [--force] [--dry-run] [--json] (--help for details)';
// --check exit codes (5/4 not 3/4: a `handed over` run already holds 3) and the next-command strings it prints.
export const CHECK_EXIT = { fresh: 0, 'rehash-safe': 5, rebuild: 4 };
export const REHASH_CMD = 'node skills/rollout/scripts/workspace-manifest.mjs --rehash-only';
export const REBUILD_CMD = 're-run inventory.mjs + blocks.mjs, then block-origin.mjs --verify, then workspace-manifest.mjs';

const serialize = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const fail = (code, msg) => { console.error(`rollout workspace-manifest: ${msg}`); return code; };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function parseArgs(argv) {
  const opts = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (VALUE_FLAGS.includes(name)) {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `--${name} needs a value` };
      opts[name] = v;
      i += 1;
    } else if (BOOL_FLAGS.includes(name)) opts.flags.add(name);
    else return { error: `unknown argument "${argv[i]}"` };
  }
  return opts;
}

/** git without a shell; GIT_DIR & co. from a calling hook would point it at another repository. */
function git(project, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)));
  const r = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
  return r.status === 0 ? r.stdout : null;
}

/** Whether git tracks the content: true/false only when the project is its own repository root, else null. */
function contentTracked(project, contentRel) {
  const top = git(project, ['rev-parse', '--show-toplevel']);
  let own = false;
  try { own = top !== null && realpathSync(top.trim()) === realpathSync(project); } catch { own = false; }
  const listed = own ? git(project, ['ls-files', '--', contentRel || '.']) : null;
  return listed === null ? null : listed.trim() !== '';
}

/**
 * The version that built THIS export, from a source that exists wherever the script runs, tried in order:
 *   1. rollout.json's _provenance.stardustVersion (what inventory.mjs recorded for this export) — export-local, so a
 *      recompute by any build reads the same value and _provenance never drifts between the in-run write and a re-hash;
 *   2. the STARDUST_VERSION env a runner may set;
 *   3. the installed plugin's manifest (a hidden `.<name>-plugin` dir) — the plugin-tree fallback when there is no
 *      rollout.json (a bare coverage dir, or a test).
 * In the image the skills run from a `stardust/scripts/…` copy with no plugin manifest above them, so the dir walk
 * alone returned null and a released-worktree recompute (which finds its own manifest) differed by exactly that field;
 * rollout.json sits beside the coverage and carries the version inventory resolved — from the plugin manifest, else
 * the same STARDUST_VERSION env, else 0.0.0 — so (1) and (2) agree within a run. The recorded string is returned
 * verbatim (0.0.0 included — the honest "unknown" inventory stamps when neither its manifest nor the env resolves), else null.
 */
function stardustVersion(out) {
  const recorded = (readJSON(join(out, 'rollout.json'), {})._provenance || {}).stardustVersion;
  if (typeof recorded === 'string' && recorded) return recorded;
  const env = process.env.STARDUST_VERSION;
  if (typeof env === 'string' && env) return env;
  for (let dir = HERE, level = 0; level <= 5; dir = dirname(dir), level += 1) {
    let names = [];
    try { names = readdirSync(dir).filter((n) => /^\.[a-z]+-plugin$/.test(n)).sort(byStr); } catch { /* unreadable */ }
    for (const n of names) {
      const pj = readJSON(join(dir, n, 'plugin.json'));
      if (pj && pj.name === 'stardust') return typeof pj.version === 'string' ? pj.version : null;
    }
  }
  return null;
}

const subdirs = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(byStr); } catch { return []; }
};

function walkHtml(dir, acc = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) walkHtml(join(dir, e.name), acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(join(dir, e.name));
  }
  return acc;
}

/** Every file under `dir` (recursively, dotfiles skipped) whose basename `match` accepts, absolute paths. */
function walkMatch(dir, match, acc = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) walkMatch(join(dir, e.name), match, acc);
    else if (e.isFile() && match(e.name)) acc.push(join(dir, e.name));
  }
  return acc;
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/**
 * block-origin.mjs's own inputs under `project`, so the export's freshness is measured on what the
 * mapping was built from: the captures (<project>/stardust/current/pages/<slug>.html, or `capturesDir`),
 * the eds-schema sidecars (the .json files under <project>/stardust/eds-schema) and the encoder maps
 * (a vocabulary.json under <project>/stardust/import or stardust/migrate/encode — the dirs block-origin
 * reads). The same set the tree is hashed from in done-check.mjs, so a sidecar, capture or map changed
 * after the mapping shows as a differing hash.
 */
export function blockOriginInputDirs(project, capturesDir = join(project, 'stardust', 'current', 'pages')) {
  return {
    capturesDir,
    edsDir: join(project, 'stardust', 'eds-schema'),
    encodeDirs: [join(project, 'stardust', 'import'), join(project, 'stardust', 'migrate', 'encode')].filter(isDir),
  };
}

// The top zero-confidence blocks named in the manifest; the whole count stays in `zeroConfidence`, this breakdown is capped.
const SELECTOR_QUALITY_TOP = 10;
// A verified selector below this confidence is low-confidence. block-origin's confidence is coveredShare — the share
// of the block's text the selected element holds (images never text) — so below 0.5 the element holds a MINORITY of
// that text: a fragment (a heading, a 16-character span) anchors the selector, evidence against it as the block's
// origin, while it resolves to one element and a per-selector client reads it as any other (in a recorded hands-off
// run 45 of 124 verified selectors, 33 of them under 0.25, shipped so with no line naming them). The bar is
// block-origin's own `>0–<0.5` status bucket (countsOf), so all three agree on the bar — the manifest counts verified
// instances only, block-origin's status line counts them all. The
// confidence-0 position fallbacks are zeroConfidence, counted apart; an unverified instance is not a selector a client reads.
export const LOW_CONFIDENCE = 0.5;
const isLowConfidence = (i) => !!i && i.verified === true && typeof i.confidence === 'number' && i.confidence > 0 && i.confidence < LOW_CONFIDENCE;

// The verdicts migrate's encode-attempt.mjs records (its VERDICTS), read here, never written; a record with any other
// verdict is not a decision and counts as no record.
const ENCODE_VERDICTS = ['encoded', 'no-roundtrip', 'not-attempted', 'hand-authored'];
// Every byTemplate encode decision → its selectorQuality.encode counter.
const ENCODE_COUNTER = { encoded: 'encoded', 'no-roundtrip': 'noRoundtrip', 'not-attempted': 'notAttempted', 'hand-authored': 'handAuthored', 'not-applicable': 'notApplicable', unrecorded: 'unrecorded' };
// A template id used as a path segment: letters, digits, _ . - and not only dots (as encode-attempt.mjs validates it).
const pathSafeId = (t) => typeof t === 'string' && /^[\w.-]+$/.test(t) && !/^\.+$/.test(t);
// The owner's reason a record carries is quoted into the manifest up to this many characters.
const REASON_MAX = 300;

/**
 * The encode decision migrate recorded for `templateId` — <project>/stardust/migrate/encode/<templateId>.json, written
 * by migrate/encode-attempt.mjs (`{_provenance: {writtenBy, writtenAt}, template, verdict, roundtrip, lint, reason,
 * pages, siblings, encoded, at, source, …}`) — read tolerantly: a JSON object whose `verdict` is one of
 * ENCODE_VERDICTS and whose `template`, when a string, is this template; `recordedAt` = its `at`, else
 * `_provenance.writtenAt`, else null; `reason` = its `reason` trimmed, capped at REASON_MAX chars (an ellipsis closes a
 * cut one), null when absent or blank. Every other key is ignored, so older or richer records read alike. null when
 * there is no such record (absent, unreadable, another template's, an unknown verdict). Never writes. Pure but for
 * the one read.
 */
export function encodeRecordOf(project, templateId) {
  if (!project || !pathSafeId(templateId)) return null;
  const file = join(project, 'stardust', 'migrate', 'encode', `${templateId}.json`);
  if (!isFile(file)) return null;
  let rec;
  try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (typeof rec.template === 'string' && rec.template !== templateId) return null;
  if (!ENCODE_VERDICTS.includes(rec.verdict)) return null;
  const recordedAt = [rec.at, rec._provenance && rec._provenance.writtenAt].find((v) => typeof v === 'string' && v) ?? null;
  const why = typeof rec.reason === 'string' ? rec.reason.trim() : '';
  const reason = !why ? null : why.length > REASON_MAX ? `${why.slice(0, REASON_MAX - 1)}…` : why;
  return { verdict: rec.verdict, recordedAt, reason };
}

/**
 * The template's encoder vocabulary as block-origin.mjs resolves it by default (its --encode default): the
 * project-relative `stardust/import/<templateId>/vocabulary.json` when stardust/import is a directory, else
 * `stardust/migrate/encode/<templateId>/vocabulary.json`; null when that file is absent (an explicit --encode dir
 * block-origin was given is not known here — the decision still derives from the mapping). Pure but for the stat.
 */
export function vocabularyOf(project, templateId) {
  if (!project || !pathSafeId(templateId)) return null;
  const dir = isDir(join(project, 'stardust', 'import')) ? ['stardust', 'import'] : ['stardust', 'migrate', 'encode'];
  return isFile(join(project, ...dir, templateId, 'vocabulary.json')) ? [...dir, templateId, 'vocabulary.json'].join('/') : null;
}

/**
 * One template's encode decision — the record's verdict, never an inference from the mapping: `encoded`,
 * `no-roundtrip`, `not-attempted` or `hand-authored` as migrate's encode-attempt.mjs recorded it (the one source that
 * knows whether the encoder ran and what its round trip said; an encoder-map selector in the mapping proves a
 * vocabulary matched the captures, not that the archetype round-tripped — in a recorded hands-off run a template
 * with 50 encoder-map selectors carried a `no-roundtrip` record and nine forked siblings, and the manifest read
 * `encoded`); else `not-applicable` for a template of at most one page (no sibling to encode, nothing to decide);
 * else `unrecorded` — a multi-page template with no record at all, the case a reviewer cannot interpret
 * (done-check.mjs counts these as export_quality:encode_unrecorded). Pure.
 */
export function encodeDecisionOf({ record = null, pages = 0 } = {}) {
  if (record && ENCODE_VERDICTS.includes(record.verdict)) return record.verdict;
  return pages > 1 ? 'unrecorded' : 'not-applicable';
}

/**
 * The selectorQuality block derived from mapping.json at manifest time (block-origin's countsOf; mapping.json is NOT
 * rewritten): instances, the selector sources ({encoderMap, textAlignment, imageAlignment, position}), encoderCoverage
 * (encoder-map/instances, 0–1 to three decimals), zeroConfidence (the confidence-0 count — position fallbacks: no
 * encoder-map marker, no text match, no uniquely matched image), the top zeroConfidenceBlocks ([{block, instances}], the position fallbacks that make it up,
 * sorted), lowConfidence (the verified instances at 0 < confidence < LOW_CONFIDENCE — selectors a per-selector client
 * reads whose element holds a minority of the block's text; done-check.mjs surfaces it as export_quality:low_confidence),
 * byTemplate ([{template, instances, encoderMap, textAlignment, imageAlignment, position, encoderCoverage, lowConfidence, encode}], one row
 * per mapping template, most instances first, so a reviewer sees which templates are encoder-backed and which fell
 * back — `encode {decision, reason, vocabulary, recordedAt}` says whether the encoder was tried, skipped or never
 * applicable (encodeDecisionOf over migrate's record under `project` and the template's page count — never the
 * encoder-map count; vocabularyOf names the map; `reason` and `recordedAt` are the record's, null without one — a
 * decision the page count made) so `encoderCoverage` reads with its
 * reason) and `encode` ({encoded, noRoundtrip, notAttempted, handAuthored, notApplicable, unrecorded}, the decisions
 * counted). null when there is no readable
 * mapping (nothing shipped to measure). Derived, so --check keeps it out of the drift classification (it hashes only
 * inputs/outputs; the encode records are never hashed). Pure but for the reads.
 */
export function selectorQualityOf(mappingFile, { project = null } = {}) {
  if (!isFile(mappingFile)) return null;
  let mapping;
  try { mapping = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch { return null; }
  if (!mapping || !Array.isArray(mapping.templates)) return null;
  const c = countsOf(mapping);
  const round3 = (x) => Math.round(x * 1000) / 1000;
  const encode = Object.fromEntries(Object.values(ENCODE_COUNTER).map((k) => [k, 0]));
  const byTemplate = mapping.templates.map((t) => {
    const insts = (Array.isArray(t.blocks) ? t.blocks : []).flatMap((b) => (Array.isArray(b.instances) ? b.instances : []));
    const bySource = (s) => insts.filter((i) => i && i.source === s).length;
    const encoderMap = bySource('encoder-map');
    const template = t.templateId ?? t.id ?? null;
    // the template's pages: block-origin's pages[] (its sorted slugs), else the slugs its instances sit on
    const slugs = Array.isArray(t.pages) ? t.pages : insts.map((i) => i && i.slug);
    const pages = new Set(slugs.filter((s) => typeof s === 'string' && s)).size;
    const record = encodeRecordOf(project, template);
    // the record decides; its stamp and reason travel with it (a decision the page count made carries null for both)
    const decision = encodeDecisionOf({ record, pages });
    encode[ENCODE_COUNTER[decision]] += 1;
    return {
      template, instances: insts.length,
      encoderMap, textAlignment: bySource('text-alignment'), imageAlignment: bySource('image-alignment'), position: bySource('position'),
      encoderCoverage: insts.length ? round3(encoderMap / insts.length) : 0,
      lowConfidence: insts.filter(isLowConfidence).length,
      encode: { decision, reason: record ? record.reason : null, vocabulary: vocabularyOf(project, template), recordedAt: record ? record.recordedAt : null },
    };
  }).sort((a, b) => b.instances - a.instances || byStr(a.template, b.template));
  return {
    instances: c.instances,
    sources: { encoderMap: c.sources['encoder-map'], textAlignment: c.sources['text-alignment'], imageAlignment: c.sources['image-alignment'], position: c.sources.position },
    encoderCoverage: c.instances ? round3(c.sources['encoder-map'] / c.instances) : 0,
    zeroConfidence: c.confidence.none,
    zeroConfidenceBlocks: Object.entries(c.positionBlocks).slice(0, SELECTOR_QUALITY_TOP).map(([block, instances]) => ({ block, instances })),
    lowConfidence: byTemplate.reduce((n, t) => n + t.lowConfidence, 0),
    byTemplate,
    encode,
  };
}

/**
 * The mapping sections with no source selector, derived from mapping.json (NOT a rewrite of it, like selectorQuality):
 * reason `no-selector` — a template section whose `selector` is null/absent (generalise found no selector resolving to
 * its element on any page), so a client projecting per selector cannot emit it and its declared blocks go with it. A
 * property of the export, exact. The second reason this list once carried, `blocks-unprojected` (a section with a
 * selector whose declared blocks no variant's first entry homed to), was a PREDICTION of one adopter's per-selector
 * merge: a recorded hands-off run's export declared seven, and the adopter that read it — one that names a block in
 * every section that places one — reconciled all seven to zero with a note. An export states its own properties,
 * never a client's behaviour, so the reason is retired: the writer never emits it (a reader of an older manifest may
 * still meet the value; the schema keeps it as deprecated), and the one-off variants behind such sections are
 * counted in variantsSummary.singleUse.
 * Each gap: { page (the section's first page, else the templateId), template (templateId), section (id), reason,
 * blocks (the declared block names dropped) }. Entries in template then section emission order. null (field omitted) when
 * there is no readable mapping; [] when a mapping has no such section. Derived, so --check never counts it as drift and
 * --rehash-only recomputes it. Pure but for the one read.
 */
export function sectionGapsOf(mappingFile) {
  if (!isFile(mappingFile)) return null;
  let mapping;
  try { mapping = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch { return null; }
  if (!mapping || !Array.isArray(mapping.templates)) return null;
  const gaps = [];
  for (const t of mapping.templates) {
    for (const s of (Array.isArray(t.sections) ? t.sections : [])) {
      if (!s || s.selector) continue;
      const page = (Array.isArray(s.pages) && s.pages[0]) || t.templateId;
      gaps.push({ page, template: t.templateId, section: s.id, reason: 'no-selector', blocks: Array.isArray(s.blocks) ? [...s.blocks] : [] });
    }
  }
  return gaps;
}

/** The owner handover sentence for the section gaps (the no-selector count; any other reason adds none); [] when there are none. */
export function sectionGapNotes(gaps) {
  const nulls = Array.isArray(gaps) ? gaps.filter((g) => g && g.reason === 'no-selector').length : 0;
  return nulls ? [`${nulls} section(s) have no source selector; an adopter projecting per selector drops them — see sectionGaps`] : [];
}

/** A judged field is still open when it is empty: null/'', an empty array, or an object all of whose values are empty (e.g. an untouched reuseGuidance {suitableFor:[], notSuitableFor:[]}). */
const isEmptyJudged = (v) => v == null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEmptyJudged));

/**
 * The judgement's documentation debt, derived from judgement.json at manifest time (not a rewrite): `toFill` counts the
 * fields the judgement lists in its own `toFill[]` that are STILL empty, and `byKind` splits that count by field
 * (name, description, purpose, reuseGuidance, baseType). null when there is no readable judgement.json with a toFill[].
 * Distinct from `placeholders`, which counts unjudged values in COVERAGE: a client may carry filled coverage while the
 * judgement still has open fields (block purpose / reuseGuidance / a default-fallback baseType). done-check.mjs surfaces
 * `toFill` as the export_quality:judgement_to_fill info line. Derived, so --check keeps it out of the drift
 * classification (it hashes only inputs/outputs; judgement.json is itself a hashed input). Pure but for the one read.
 */
export function judgementDebtOf(judgementFile) {
  if (!isFile(judgementFile)) return null;
  let j;
  try { j = JSON.parse(readFileSync(judgementFile, 'utf8')); } catch { return null; }
  if (!j || !Array.isArray(j.toFill)) return null;
  const at = (path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j);
  const byKind = {};
  let toFill = 0;
  for (const path of j.toFill) {
    if (typeof path !== 'string' || !isEmptyJudged(at(path))) continue;
    toFill += 1;
    const kind = path.split('.').pop();
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return { toFill, byKind: Object.fromEntries(Object.keys(byKind).sort(byStr).map((k) => [k, byKind[k]])) };
}

/** Whether a capture dir holds a capture (a <slug>.html or <slug>.json file): the export then needs mapping.json. */
export function hasCaptures(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && !e.name.startsWith('.') && /\.(html|json)$/.test(e.name)); } catch { return false; }
}

/**
 * The manifest's inputs as on disk, keys sorted: `content` {files, sha256[, tracked when given]} (one hash over the
 * sorted "<project-relative path> <sha>" lines of every <content>/**.html), each <blocks>/<n>/<n>.{js,css}, the
 * judgement when it is a file, and — so the export's freshness covers what block-origin.mjs built the mapping from —
 * each capture (an .html under <capturesDir>), each eds-schema sidecar (a .json under <edsDir>) and each
 * encoder map (a vocabulary.json under <encodeDirs>), by project-relative path to sha256. Also returns the content hashes by
 * content-relative path and the counts readArtifacts needs. done-check.mjs compares a manifest against it.
 */
export function inputHashes({ project, contentDir, blocksDir, judgementFile, tracked, capturesDir = null, edsDir = null, encodeDirs = [] }) {
  const relP = (abs) => relative(project, abs).split(sep).join('/');
  const contentHashes = new Map(walkHtml(contentDir).map((abs) => [relative(contentDir, abs).split(sep).join('/'), sha256(readFileSync(abs))]));
  const lines = [...contentHashes].map(([rel, sha]) => `${relP(join(contentDir, rel))} ${sha}\n`).sort(byStr);
  const inputs = { content: { files: lines.length, sha256: sha256(lines.join('')), ...(tracked === undefined ? {} : { tracked }) } };
  let blockFiles = 0;
  for (const name of subdirs(blocksDir)) {
    for (const ext of ['js', 'css']) {
      const file = join(blocksDir, name, `${name}.${ext}`);
      if (isFile(file)) { inputs[relP(file)] = sha256(readFileSync(file)); blockFiles += 1; }
    }
  }
  const judged = isFile(judgementFile);
  if (judged) inputs[relP(judgementFile)] = sha256(readFileSync(judgementFile));
  // block-origin's inputs: a capture, sidecar or map changed after the mapping is a differing hash here.
  const addFiles = (files) => { for (const abs of files) inputs[relP(abs)] = sha256(readFileSync(abs)); };
  if (capturesDir) addFiles(walkMatch(capturesDir, (n) => n.endsWith('.html')));
  if (edsDir) addFiles(walkMatch(edsDir, (n) => n.endsWith('.json')));
  for (const d of encodeDirs) addFiles(walkMatch(d, (n) => n === 'vocabulary.json'));
  return { inputs: Object.fromEntries(Object.keys(inputs).sort(byStr).map((k) => [k, inputs[k]])), contentHashes, contentFiles: lines.length, blockFiles, judged };
}

/** blocks.json module rows blocks.mjs enriches (kind module, EDS name not default-content), by EDS name, first row wins. */
export function moduleBlocks(blocksDoc) {
  const byName = new Map();
  for (const b of (blocksDoc && blocksDoc.blocks) || []) {
    if (!b || (b.kind || kindOf(b.id)) !== 'module') continue;
    const name = (b.delivery && b.delivery.edsBlockName) || edsName(b.id);
    if (name !== DEFAULT_CONTENT && !byName.has(name)) byName.set(name, b);
  }
  return byName;
}

// a conversion record: update-coverage.mjs --block … --status converted|deployed|verified, or not-delivered with its reason
const RECORDED = new Set(['converted', 'deployed', 'verified', 'not-delivered']);
/**
 * The module blocks still pending, by EDS name, sorted: delivered instances (variants[].instances, from the pages'
 * content files) and no conversion record. A row no page delivers is not pending — nothing of it shipped. Pure.
 */
export function pendingBlocks(blocksDoc) {
  const delivered = (b) => (Array.isArray(b.variants) ? b.variants : []).reduce((n, v) => n + (v && typeof v.instances === 'number' ? v.instances : 0), 0);
  return [...moduleBlocks(blocksDoc)].filter(([, b]) => delivered(b) > 0 && !RECORDED.has(b.delivery && b.delivery.status))
    .map(([name]) => name).sort(byStr);
}

/**
 * The template count split from coverage/templates.json: `archetypes` = the distinct page `type`s (each untyped
 * template its own archetype), `siblings` = the templates beyond the first of each type — the cloned siblings the
 * export emits as their own group (so the template count exceeds the archetype count). block-origin groups the mapping
 * by templateId (the page slug) and no coverage field records a sibling's parent archetype, so the split is by type,
 * not a parent link. Derived from coverage, so --check never counts it as drift. Pure.
 */
export function templateGroupsOf(templates) {
  const list = Array.isArray(templates) ? templates : [];
  const types = new Set();
  let siblings = 0;
  for (const t of list) {
    const type = t && typeof t.type === 'string' && t.type ? t.type : null;
    if (type === null) continue; // an untyped template is its own archetype
    if (types.has(type)) siblings += 1; else types.add(type);
  }
  return { total: list.length, archetypes: list.length - siblings, siblings };
}

/**
 * Planned URLs that never became a page — [{url, reason}] sorted by url — derived at manifest time from what the
 * coverage and the plan know (never a drift input: --rehash-only recomputes it, --check never counts it). Sources in
 * order, the first record of a URL winning (one planned page whatever its trailing slash, .html or /index):
 *   - the coverage's own excluded[] rows (state.mjs exclude, through inventory.mjs): url = sourceUrl, else path, else
 *     /<slug>; the recorded reason, `unrecorded` when it has none;
 *   - the crawl's failed URLs (<stardust>/current/_crawl-log.json crawl.failures[], written by the extract crawl):
 *     `crawl: <message>` (e.g. `crawl: HTTP 404`; `crawl: failed` without a message);
 *   - state.json pages[] (a page's own excluded.reason when it carries one, else `unrecorded`) and its top-level
 *     excluded[] (the recorded reason);
 *   - plan.json steps, url = the step's delivered path: `unrecorded`.
 * A planned entry IS a page — and is left out — when a pages[] row shares its URL (urlToDeliveredPath of both), its
 * delivered path or its slug. [] when every planned URL is a page. Pure.
 */
export function excludedOf({ pages = [], excluded = [], state = null, crawlLog = null, plan = null } = {}) {
  const known = new Set();
  for (const p of (Array.isArray(pages) ? pages : []).filter(isMap)) {
    if (typeof p.slug === 'string') known.add(`slug:${p.slug}`);
    if (typeof p.path === 'string') known.add(`path:${p.path}`);
    const u = p.source && p.source.sourceUrl;
    if (typeof u === 'string' && u) known.add(`path:${urlToDeliveredPath(u)}`);
  }
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const out = new Map(); // delivered path → { url, reason }
  const add = ({ url, slug, path, reason }) => {
    const where = str(url) || str(path) || (str(slug) ? `/${str(slug)}` : null);
    if (!where) return;
    const key = urlToDeliveredPath(where);
    if ((str(slug) && known.has(`slug:${str(slug)}`)) || known.has(`path:${key}`) || (str(path) && known.has(`path:${str(path)}`))) return;
    if (!out.has(key)) out.set(key, { url: where, reason: str(reason) || 'unrecorded' });
  };
  const rows = (v) => (Array.isArray(v) ? v.filter(isMap) : []);
  for (const e of rows(excluded)) add({ url: e.sourceUrl, slug: e.slug, path: e.path, reason: e.reason });
  for (const f of rows(isMap(crawlLog) && isMap(crawlLog.crawl) ? crawlLog.crawl.failures : [])) add({ url: f.url, slug: f.slug, reason: `crawl: ${str(f.message) || 'failed'}` });
  for (const p of rows(isMap(state) ? state.pages : [])) add({ url: p.url, slug: p.slug, reason: isMap(p.excluded) ? p.excluded.reason : null });
  for (const e of rows(isMap(state) ? state.excluded : [])) add({ url: e.url, slug: e.slug, reason: e.reason });
  for (const s of rows(isMap(plan) ? plan.steps : [])) add({ slug: s.slug, path: s.path, reason: null });
  return [...out.values()].sort((a, b) => byStr(a.url, b.url));
}

/** The delivered module blocks whose base type is not judged (`unknown` or missing — `unknown` is not a judged value), by EDS name, sorted. done-check.mjs reads this too. */
export function unjudgedBaseTypes(blocksDoc) {
  return [...moduleBlocks(blocksDoc)].filter(([, b]) => !b.baseType || b.baseType === 'unknown').map(([name]) => name).sort(byStr);
}

/** Summary lines for what a client gets as a default: fields not judged (colorScheme is optional), pages without a content file, blocks pending (pendingBlocks). Sorted. */
export function placeholdersOf(coverage) {
  const templates = coverage.templates.templates;
  const blocks = [...moduleBlocks(coverage.blocks).values()];
  const count = (rows, test) => rows.filter(test).length;
  return [
    ['templates[].name', count(templates, (t) => !t.name), 'template(s) without a name (not judged)'],
    ['templates[].description', count(templates, (t) => !t.description), 'template(s) without a description (not judged)'],
    ['blocks[].baseType', count(blocks, (b) => !b.baseType || b.baseType === 'unknown'), 'block(s) unknown (not judged)'],
    ['blocks[].purpose', count(blocks, (b) => !b.purpose), 'block(s) without purpose (not judged)'],
    ['blocks[].reuseGuidance', count(blocks, (b) => !b.reuseGuidance), 'block(s) without reuse guidance (not judged)'],
    ['pages[].delivered', count(coverage.pages.pages, (p) => p.delivered == null), 'page(s) without a content file (null)'],
    ['blocks[].delivery', pendingBlocks(coverage.blocks).length, 'block(s) delivered without a conversion record (update-coverage.mjs --block)'],
  ].filter(([, n]) => n).map(([field, n, why]) => `${field}: ${n} ${why}`).sort(byStr);
}

/**
 * The judgement.json a model fills, from coverage: every field to judge empty (a known base type pre-filled),
 * suggestions under `defaults` (scrubbed; an empty template name or description stays absent in coverage, an empty
 * base type keeps the coverage default), and `toFill` (informational) listing the empty fields to judge — colorScheme
 * is optional and not listed.
 */
export function draftJudgement(coverage, provenance, tokens = []) {
  const [templates, blocks, toFill, used] = [{}, {}, [], new Set()];
  const defaults = { templates: {}, blocks: {} };
  for (const t of [...coverage.templates.templates].sort((a, b) => byStr(a.id, b.id))) {
    const base = kebab(t.type || t.id) || 'template';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
    used.add(name);
    const ids = [...new Set((t.blocks || []).filter((id) => kindOf(id) === 'module'))].sort(byStr);
    const pages = typeof t.pageCount === 'number' ? t.pageCount : (t.pages || []).length;
    templates[t.id] = { name: '', description: '' };
    defaults.templates[t.id] = {
      name: scrubIdentity(name, tokens),
      description: scrubIdentity(`${name}: ${pages} page(s); blocks ${ids.length ? ids.join(', ') : 'none'}.`, tokens),
    };
    toFill.push(`templates.${t.id}.name`, `templates.${t.id}.description`);
  }
  for (const [name, b] of [...moduleBlocks(coverage.blocks)].sort(([a], [c]) => byStr(a, c))) {
    const baseType = b.baseType && b.baseType !== 'unknown' ? b.baseType : '';
    blocks[name] = { baseType, purpose: '', reuseGuidance: { suitableFor: [], notSuitableFor: [] }, colorScheme: '' };
    // unknown is not a judged value: an unjudged block stays in toFill and the owner picks from the candidate list.
    defaults.blocks[name] = { baseType: b.baseType || 'unknown', ...(baseType ? {} : { baseTypeCandidates: BASE_TYPE_CANDIDATES }) };
    toFill.push(`blocks.${name}.purpose`, `blocks.${name}.reuseGuidance`);
    if (!baseType) toFill.push(`blocks.${name}.baseType`);
  }
  return { _provenance: provenance, templates, blocks, defaults, toFill: toFill.sort(byStr) };
}

/** Write through a sibling temp file renamed into place; on failure the temp file (and a dir this call made) is removed. */
export function writeAtomic(path, text, hooks = {}) {
  const made = mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    if (hooks.beforeRename) hooks.beforeRename(path);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    if (made) rmSync(made, { recursive: true, force: true });
    throw e;
  }
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) return fail(2, `${opts.error}\n${USAGE}`);
  const { flags } = opts;
  const modes = ['check', 'rehash-only', 'draft-judgement'].filter((f) => flags.has(f));
  if (modes.length > 1) return fail(2, `--${modes.join(' and --')} cannot be combined\n${USAGE}`);
  const dry = flags.has('dry-run');
  const out = opts.out || join('stardust', 'rollout');
  const OUT = resolve(out);
  const project = resolve(opts.project || '.');
  const contentDir = resolve(opts.content || join(project, 'content'));
  const blocksDir = resolve(opts.blocks || join(project, 'blocks'));
  const W = join(OUT, 'workspace');
  const shown = join(out, 'workspace');
  const relP = (abs) => relative(project, abs).split(sep).join('/');

  // --- Handover: once a client adopted the project, stardust stops writing --------
  const priorManifest = readJSON(join(W, FILES.manifest));
  const tracked = contentTracked(project, relP(contentDir));
  let detectedFrom = null;
  if (existsSync(join(W, FILES.handover))) detectedFrom = 'marker';
  else if (priorManifest && priorManifest.handover) detectedFrom = 'manifest';
  else if (priorManifest?.inputs?.content?.tracked === true && tracked === false) detectedFrom = 'untracked-content';
  if (detectedFrom && !flags.has('force') && !flags.has('check')) {
    const why = {
      marker: `${join(shown, FILES.handover)} exists (a client adopted the project)`,
      manifest: 'the last manifest records a handover (a forced run)',
      'untracked-content': 'the content the last manifest was built from is no longer tracked by git',
    }[detectedFrom];
    if (flags.has('json')) {
      console.log(JSON.stringify({ status: 'handed-over', dir: shown, hashes: {}, counts: null, placeholders: 0, handover: { at: null, detectedFrom }, degraded: false }));
    }
    return fail(3, `handed over: ${why} — nothing written; --force writes the manifest anyway`);
  }
  // a handover already recorded (an earlier forced run) is kept as is, so a forced re-run stays byte-identical
  const recorded = priorManifest && priorManifest.handover;
  const handover = !detectedFrom ? null
    : recorded ? { at: recorded.at, detectedFrom: recorded.detectedFrom } : { at: new Date().toISOString(), detectedFrom };

  // --- Coverage: the three files, this format, and fresh ---------------------------
  const coverage = {};
  const outputs = {};
  for (const name of COVERAGE) {
    const file = join(OUT, 'coverage', `${name}.json`);
    const shownFile = join(out, 'coverage', `${name}.json`);
    let buf = null;
    let doc = null;
    try { buf = readFileSync(file); doc = JSON.parse(buf.toString('utf8')); } catch { doc = null; }
    if (!doc || !Array.isArray(doc[name]) || typeof doc.formatVersion !== 'string') {
      return fail(1, `${shownFile} missing, unreadable or without formatVersion — run inventory.mjs and blocks.mjs first`);
    }
    if (doc.formatVersion !== COVERAGE_FORMAT_VERSION) {
      return fail(1, `${shownFile} has formatVersion ${doc.formatVersion}; this script reads ${COVERAGE_FORMAT_VERSION} — run this release's inventory.mjs and blocks.mjs`);
    }
    coverage[name] = doc;
    outputs[relP(file)] = sha256(buf);
  }
  const mappingFile = join(W, FILES.mapping);
  if (isFile(mappingFile)) outputs[relP(mappingFile)] = sha256(readFileSync(mappingFile));
  const capturesDir = resolve(opts.captures || join(project, 'stardust', 'current', 'pages'));
  const missing = !flags.has('allow-no-mapping') && hasCaptures(capturesDir) && !isFile(mappingFile) ? [join(shown, FILES.mapping)] : [];

  // --- Inputs: what the coverage was built from ------------------------------------
  const judgementFile = join(W, FILES.judgement);
  const { capturesDir: edsCapturesDir, edsDir, encodeDirs } = blockOriginInputDirs(project, capturesDir);
  const { inputs: sortedInputs, contentHashes, contentFiles, blockFiles, judged } = inputHashes({ project, contentDir, blocksDir, judgementFile, tracked, capturesDir: edsCapturesDir, edsDir, encodeDirs });

  const readArtifacts = [...Object.keys(outputs), ...(contentFiles ? [relP(contentDir)] : []),
    ...(blockFiles ? [relP(blocksDir)] : []), ...(judged ? [relP(judgementFile)] : [])].sort(byStr);
  const provenance = {
    writtenBy: WRITTEN_BY,
    writtenAt: coverage.pages.generatedAt || coverage.pages._provenance?.writtenAt || null,
    readArtifacts,
    stardustVersion: stardustVersion(OUT),
  };
  const placeholders = placeholdersOf(coverage);
  const templateGroups = templateGroupsOf(coverage.templates.templates);
  // blocks.mjs writes the same figures at the top of blocks.json (lib.variantsSummaryOf, so the two agree); derived
  // from coverage, so a re-hash recomputes it and --check never counts it as drift
  const variantsSummary = variantsSummaryOf(coverage.blocks.blocks);
  // the planned URLs that never became a page: the coverage's excluded[] rows, the crawl log, the state roster, the plan
  const stardustDir = dirname(OUT);
  const excluded = excludedOf({
    pages: coverage.pages.pages,
    excluded: coverage.pages.excluded,
    state: readJSON(join(stardustDir, 'state.json')),
    crawlLog: readJSON(join(stardustDir, 'current', '_crawl-log.json')),
    plan: readJSON(join(OUT, 'plan.json')),
  });
  const mods = [...moduleBlocks(coverage.blocks).values()];
  const variants = mods.flatMap((b) => (Array.isArray(b.variants) ? b.variants : []));
  // Derived from mapping.json (not a rewrite of it), so it is recomputed on a re-hash and never counts as drift
  // (--check hashes only inputs/outputs); computed here so the --json counts and the printed line carry its figures.
  const selectorQuality = selectorQualityOf(mappingFile, { project });
  const counts = {
    templates: coverage.templates.templates.length,
    archetypes: templateGroups.archetypes,
    siblingGroups: templateGroups.siblings,
    pages: coverage.pages.pages.length,
    blocks: mods.length,
    variants: variants.length,
    singleUseVariants: variantsSummary.singleUse,
    instances: variants.reduce((n, v) => n + (typeof v.instances === 'number' ? v.instances : 0), 0),
    excluded: excluded.length,
    lowConfidence: selectorQuality ? selectorQuality.lowConfidence : null,
  };

  const report = (status, hashes, extra = {}) => {
    const degraded = !!extra.degraded;
    const lacking = extra.missing || [];
    if (flags.has('json')) {
      console.log(JSON.stringify({ status, dir: shown, hashes, counts, placeholders: placeholders.length, handover, degraded, missing: lacking }));
    } else {
      const withoutContent = coverage.pages.pages.filter((p) => p && p.delivered == null).length;
      // when cloned siblings add their own template group the count exceeds the archetype count — name the split
      const tpl = counts.siblingGroups > 0 ? `${counts.templates} templates (${counts.archetypes} archetypes + ${counts.siblingGroups} sibling groups)` : `${counts.templates} templates`;
      console.log(`rollout workspace-manifest → ${shown}`);
      console.log('='.repeat(60));
      console.log(`Coverage      ${tpl} · ${counts.pages} pages (${withoutContent} without a content file) · ${counts.blocks} blocks (${counts.variants} variants, ${counts.singleUseVariants} single-use, ${counts.instances} instances)`);
      if (selectorQuality) console.log(`Selectors     ${selectorQuality.instances} instances · ${selectorQuality.zeroConfidence} zero-confidence · ${selectorQuality.lowConfidence} low-confidence (verified, 0 < confidence < ${LOW_CONFIDENCE})`);
      console.log(`Placeholders  ${placeholders.length}${placeholders.length ? ' (listed in manifest.json)' : ''}`);
      if (excluded.length) console.log(`Excluded      ${excluded.length} planned URL(s) never became a page (manifest.json excluded[])`);
      if (handover) console.log(`Handover      forced (detected from ${handover.detectedFrom})${degraded ? `; degraded: ${extra.degraded.inputs.length} input(s) changed` : ''}`);
      console.log(`Status        ${extra.line}`);
    }
    for (const m of lacking) console.error(`missing: ${m} — run block-origin.mjs --verify first`);
    return lacking.length ? 2 : 0;
  };

  // --- --check / --rehash-only: classify drift from the last manifest to the files on disk ---------
  const rehashing = flags.has('rehash-only');
  if (flags.has('check') || rehashing) {
    const sortedOutputs = Object.fromEntries(Object.keys(outputs).sort(byStr).map((k) => [k, outputs[k]]));
    if (!priorManifest || typeof priorManifest.inputs !== 'object') {
      return fail(rehashing ? 4 : 1, `no ${join(shown, FILES.manifest)} to check — build the export first: ${REBUILD_CMD}`);
    }
    const norm = (k, v) => JSON.stringify(k === 'content' && v && typeof v === 'object' ? [v.files, v.sha256] : v ?? null);
    const diff = (was, now) => [...new Set([...Object.keys(was || {}), ...Object.keys(now || {})])]
      .filter((k) => norm(k, (was || {})[k]) !== norm(k, (now || {})[k])).sort(byStr);
    // Drift is measured on inputs and outputs only; _provenance (writtenBy/writtenAt/stardustVersion) is never compared,
    // so a version stamp can never read as drift — the export's freshness is its recorded input/output hashes.
    const inDrift = diff(priorManifest.inputs, sortedInputs);
    const outDrift = diff(priorManifest.outputs, sortedOutputs);
    const classification = classifyExportDrift(inDrift, outDrift);
    const drifted = [...inDrift, ...outDrift].sort(byStr);
    const adopterBlocked = outDrift.includes(relP(join(OUT, 'coverage', 'pages.json')));
    const nextCmd = classification === 'rehash-safe' ? REHASH_CMD : classification === 'rebuild' ? REBUILD_CMD : null;

    if (!rehashing) {
      if (flags.has('json')) {
        console.log(JSON.stringify({ status: classification, dir: shown, drifted, next: nextCmd, adopterBlocked }));
      } else {
        console.log(`rollout workspace-manifest --check → ${shown}`);
        console.log('='.repeat(60));
        console.log(`Classification  ${classification}`);
        console.log(`Drifted         ${drifted.length ? drifted.join(', ') : '(none)'}`);
        if (adopterBlocked) console.log('Adopter         refuses this export until coverage/pages.json is refreshed');
        console.log(`Next            ${nextCmd || 'nothing to do — the export is current'}`);
      }
      return CHECK_EXIT[classification];
    }

    // --rehash-only: refuse a rebuild; else reconcile mapping.json's generatedAt and fall through to the
    // write with the current hashes (the stale guards below are skipped — this drift is rehash-safe).
    if (classification === 'rebuild') {
      if (flags.has('json')) console.log(JSON.stringify({ status: 'rebuild', dir: shown, drifted, next: REBUILD_CMD, adopterBlocked }));
      return fail(4, `rebuild needed, not a re-hash — drifted: ${drifted.join(', ') || '(none)'} — ${REBUILD_CMD}`);
    }
    const pagesAt = coverage.pages.generatedAt;
    if (isFile(mappingFile) && typeof pagesAt === 'string') {
      const mapText = readFileSync(mappingFile, 'utf8');
      let mapAt; try { mapAt = JSON.parse(mapText).generatedAt ?? null; } catch { mapAt = undefined; }
      const line = mapText.match(/^(\s*"generatedAt":\s*)(?:"[^"]*"|null)(,?)[^\n]*$/m);
      if (mapAt !== undefined && mapAt !== pagesAt && line) {
        const next = mapText.replace(line[0], () => `${line[1]}${JSON.stringify(pagesAt)}${line[2]}`);
        if (!dry) { try { writeAtomic(mappingFile, next); } catch (e) { return fail(1, `rehash write failed: ${e.message}`); } }
        outputs[relP(mappingFile)] = sha256(Buffer.from(next));
      }
    }
  }

  // --- --draft-judgement: only judgement.json, only when absent --------------------
  if (flags.has('draft-judgement')) {
    if (judged) {
      return report('draft-present', { [FILES.judgement]: sha256(readFileSync(judgementFile)) }, { line: `${FILES.judgement} present — left as is` });
    }
    const tokens = identityTokens({ rollout: readJSON(join(OUT, 'rollout.json')), state: readJSON(join(dirname(OUT), 'state.json')) });
    const text = serialize(draftJudgement(coverage, provenance, tokens));
    const hashes = { [FILES.judgement]: sha256(text) };
    if (dry) return report('dry-run', hashes, { line: `would write ${join(shown, FILES.judgement)} (dry run: nothing written)` });
    try { writeAtomic(judgementFile, text); } catch (e) { return fail(1, `write failed: ${e.message}`); }
    return report('drafted', hashes, { line: `drafted ${join(shown, FILES.judgement)}: fill the empty fields listed in toFill (colorScheme too, optionally), then re-run blocks.mjs and this script; \`defaults\` are suggestions — an empty template name or description stays absent in coverage, an empty base type keeps its default` });
  }

  // --- Freshness: coverage must describe the files on disk (the manifest run only) --
  // --rehash-only skips these refusals on purpose: --check already classified the drift rehash-safe,
  // so the block code that drifted (CSS) is exactly what a plain run would refuse — re-hashing is the fix.
  if (!rehashing) {
    const stale = coverage.pages.pages.filter((p) => {
      if (!p) return false;
      const rel = contentFileFor(p.path, (k) => contentHashes.has(k));
      return rel ? !p.delivered || p.delivered.contentHash !== contentHashes.get(rel) : p.delivered != null;
    }).map((p) => p.slug);
    if (stale.length) {
      return fail(1, `coverage is stale: ${stale.length} page(s) whose content file changed, appeared or went away since inventory.mjs ran (${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', …' : ''}) — re-run inventory.mjs and blocks.mjs`);
    }
    const blocksShown = join(out, 'coverage', 'blocks.json');
    const read = coverage.blocks._provenance && coverage.blocks._provenance.inputs;
    if (!read || typeof read !== 'object' || Array.isArray(read)) {
      return fail(1, `${blocksShown} records no _provenance.inputs (written by an older blocks.mjs) — re-run blocks.mjs`);
    }
    const at = (p) => (isAbsolute(p) ? p : resolve(project, p));
    const samePath = (a, b) => { if (a === b) return true; try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
    const off = Object.keys(read).sort(byStr).filter((p) => !isFile(at(p)) || sha256(readFileSync(at(p))) !== read[p])
      .map((p) => `${p} (${isFile(at(p)) ? 'changed' : 'gone'})`);
    if (judged && !Object.keys(read).some((p) => samePath(at(p), judgementFile))) off.push(`${relP(judgementFile)} (not read)`);
    if (off.length) return fail(1, `coverage is stale: ${blocksShown} was built from other files — ${off.join(', ')} — re-run blocks.mjs`);
  }

  // --- Manifest ---------------------------------------------------------------------
  let degraded = null;
  if (handover && priorManifest) {
    const was = priorManifest.inputs || {};
    const norm = (k, v) => JSON.stringify(k === 'content' && v ? [v.files, v.sha256] : v ?? null);
    const changed = [...Object.keys(was), ...Object.keys(sortedInputs)].filter((k) => norm(k, was[k]) !== norm(k, sortedInputs[k]));
    const union = [...new Set([...(priorManifest.degraded?.inputs || []), ...changed])].sort(byStr);
    if (union.length) degraded = { reason: `forced run after handover (${handover.detectedFrom}): inputs differ from the last manifest before it`, inputs: union };
  }
  // Derived from mapping.json / judgement.json (not a rewrite of either, like selectorQuality above), so all are
  // recomputed on a re-hash and never count as drift (--check hashes only inputs/outputs).
  const sectionGaps = sectionGapsOf(mappingFile);
  const judgement = judgementDebtOf(judgementFile);
  // unknown is not a judged base type: the owner must name these before the adopter emits them as judged metadata.
  const unjudged = unjudgedBaseTypes(coverage.blocks);
  const handoverNotes = [
    ...(unjudged.length ? [`${unjudged.length} delivered block(s) have no judged base type; the owner names them (${unjudged.join(', ')})`] : []),
    ...sectionGapNotes(sectionGaps),
  ];
  const manifest = {
    _provenance: provenance,
    formatVersion: FORMAT_VERSION,
    inputs: sortedInputs,
    outputs: Object.fromEntries(Object.keys(outputs).sort(byStr).map((k) => [k, outputs[k]])),
    placeholders,
    templateGroups,
    variantsSummary,
    excluded,
    ...(selectorQuality ? { selectorQuality } : {}),
    ...(sectionGaps ? { sectionGaps } : {}),
    ...(judgement ? { judgement } : {}),
    // an export without its mapping is not ready to hand over: no handover key (a recorded handover is kept)
    ...(missing.length && !handover ? {} : { handover }),
    ...(handoverNotes.length ? { handoverNotes } : {}),
    ...(degraded ? { degraded } : {}),
  };
  const text = serialize(manifest);
  const hashes = { [FILES.manifest]: sha256(text) };
  const file = join(W, FILES.manifest);
  if (isFile(file) && readFileSync(file).equals(Buffer.from(text))) {
    return report('unchanged', hashes, { degraded, missing, line: 'unchanged — the same bytes; nothing written' });
  }
  if (dry) return report('dry-run', hashes, { degraded, missing, line: `would ${rehashing ? 're-hash' : 'write'} ${join(shown, FILES.manifest)} (dry run: nothing written)` });
  try { writeAtomic(file, text); } catch (e) { return fail(1, `write failed: ${e.message}`); }
  if (rehashing) return report('rehashed', hashes, { degraded, missing, line: `re-hashed ${join(shown, FILES.manifest)} — input/output hashes refreshed, every other field unchanged` });
  return report('written', hashes, { degraded, missing, line: `written ${join(shown, FILES.manifest)}${missing.length ? ' without handover' : ''}` });
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.exitCode = fail(1, e.message);
  }
}
