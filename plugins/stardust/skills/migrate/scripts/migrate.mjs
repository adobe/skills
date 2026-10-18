#!/usr/bin/env node
/**
 * migrate/migrate.mjs — the migrate driver: places a page whose HTML is ready.
 *
 * It never decides content — except `encode` (encode.mjs), which applies a template's
 * authored map. The agent supplies one rendered HTML file per page (the
 * prototype, or the sibling built from an archetype) — or, for a directed sibling without
 * one, the driver forks the archetype's HTML with the page's captured typed slots — and
 * records its judgments; this
 * script does every generic step of reference/migration-procedure.md after the render
 * decision: page map (built once from every state page), output path (URL-literal rule),
 * depth-aware internal links via the page map, asset bundling with rewritten references
 * (six detection shapes, CSS files rewritten inside), provenance comment first in <head>,
 * canon `:root` first in the first <style>, default JSON-LD when the page has none,
 * data-template / data-section attributes, the _meta.json sidecar, strict validation
 * (refuse = nothing written), and the sha-based idempotent skip.
 *
 * Usage:
 *   node migrate.mjs render <slug…|--all> [--force] [--state stardust/state.json]
 *        [--proto-dir stardust/prototypes] [--current stardust/current] [--out stardust/migrated]
 *        [--canon-css <file>] [--inline-canon] [--source <slug>=<file>]…
 *        [--archetype <slug>=<archetype-slug>]… [--branch-b <slug,…>] [--from-archetype] [--slots mapping|page-json]
 *        [--accept-variance "<reason>"] [--media-map <file>] [--media-ledger <file>]
 *        [--variance-dir <dir>] [--stardust-version <v>]
 *   node migrate.mjs plan <slug…|--all> [--force] [--encoder <file>] [--source <slug>=<file>]…
 *        [--archetype <slug>=<archetype-slug>]… [--branch-b <slug,…>] [--from-archetype]
 *                                                                    → stardust/migrate/encode/<template>.json
 *   node migrate.mjs gate <slug> <gate-name> [--evidence "…"]          → gatesPassed[] / gateEvidence
 *   node migrate.mjs deviation <slug> --kind <k> [--source <s>] [--target <t>] --reason <r>
 *                                                                    → contentDeviations[]
 *   node migrate.mjs decision <slug> --kind <k> [--json '{…}']        → migrationDecisions[]
 *   node migrate.mjs variant <slug> <class…>                          → variants[] (one entry)
 *   node migrate.mjs modules <slug> <id…> | --clear                   → modules[]
 *   node migrate.mjs harness <slug> [--content content]               → the archetype's passedOn (C14)
 *   node migrate.mjs summary [--json]                                 one row per state page
 *   node migrate.mjs pagemap                                          prints the page map, writes nothing
 *   (every form takes --state / --out; paths are project-relative from the project root; a value
 *   flag followed by nothing or by another --flag is a usage error naming the flag)
 *
 * harness — record that <slug>, an encoded page, passed the local harness launches (section-schema, the
 *   whole-page block-roundtrip --ew, qa-gate) on its current document: its encode's block shape joins
 *   the archetype's `passedOn` {key, shapes[{slug, shape}]} under the template's current harness key
 *   (encode/shape.mjs: encoder + map + the map's block JS/CSS + the frozen foundation); a pass under
 *   another key replaces the record — any key change re-arms. Run it right after the launches pass,
 *   before any block edit. Refused (exit 2, nothing written) unless the page's encode is the current
 *   clean encode under this encoder and map; for the archetype, unless its gated document
 *   (<content>/<da-path>.html) and its encoded document compare equal at `core` (encode/compare.mjs:
 *   sections, section styles, items, rows × cells, normalised text — the map round-trips) and have
 *   the same block shape; for a sibling, unless passedOn under the current key already holds the
 *   archetype's pass (the archetype records first, after every key change). An equal record is not
 *   rewritten. Siblings whose shape passedOn covers inherit the launches (rollout plan.mjs
 *   needsHarness, gate-evidence.mjs).
 *
 * Flow guard (state-machine.md § Flow keys, plugin 0.23.0): `render` and `plan` refuse (exit 2) when the state
 *   file exists but has no top-level `flow` — the master skill stamps flow / flowChosenAt / flowSource
 *   when its routing resolves the two-flow question (skills/stardust/SKILL.md § Routing, § Two
 *   migration flows); either flow value passes. The sidecar-only subcommands (gate, deviation,
 *   decision, variant, modules) and summary / pagemap are not guarded.
 *
 * render — page set: --all = every page whose status is approved, migrated or directed (others
 *   print one `skip` line); explicit slugs must exist. Strict 8 (output-path collision) is checked on
 *   the literal path AND on its AEM-folded form (lowercase, `_`/spaces/unsafe characters → `-`, as
 *   delivery-lint's path-safety normalises), so `/About` and `/about/` collide before either is
 *   written. A sidecar that exists but is not valid JSON is refused (strict sidecar), never
 *   overwritten. Branch: approved/migrated with a source
 *   file → A (fidelityTier archetype); a slug in --branch-b → B (thin); directed → A' (sibling)
 *   of its archetype: --archetype <slug>=<archetype-slug>, else the page's state `representative`
 *   (state.mjs set <slug…> --representative <archetype-slug>), else the single approved/migrated
 *   page of the same type that has a source file — zero or several: refused (strict branch)
 *   until one is named. Source HTML: --source, else page.prototypePath, else
 *   <proto-dir>/<slug>-proposed.html; an A / B page without one is refused (strict source). A
 *   directed page with its own source HTML renders A' from it; without one (or with
 *   --from-archetype) it is an A' FORK of the archetype's source HTML (below). The source
 *   refusals on A': an explicit --source <slug>=<file> that does not exist (`strict source — no
 *   source HTML at <path>`; never forked instead), and `strict source — archetype <a> has no
 *   proposed HTML at <path>`.
 *   Canon CSS: --canon-css, else stardust/canon/canon.css, else the single *canon*.css under
 *   --proto-dir. Per page one line `A  <slug> → <path>  (<type>; n assets, n links, n broken,
 *   n sections)` (a fork adds `fork of <archetype>; `, with --slots mapping `fork of <archetype> via the
 *   block mapping; `), `unchanged` when the recorded shas, the variance record and the slot source match
 *   (--force overrides), `passthrough` for a non-HTML leaf,
 *   `refused <slug>: strict <n> — <what> — <fix>` on stderr. Page status is NOT advanced
 *   here — that is `state.mjs advance <slug…> --to migrated`.
 *
 * plan — Phase 1 (SKILL.md § Phase 1 — Plan): render's page set (--all prints the same `skip` lines) and each
 *   page's branch as render chooses it (the same flags; a strict branch / source refusal is printed as render
 *   prints it, on stderr); nothing rendered, no sidecar, state.json untouched. Lines: `plan: <n> page(s) — A <a> ·
 *   A' <s> on <t> template(s) · B <b> · passthrough <p> · refused <r>`, `A  <n> page(s): <slug, …>`, per template
 *   `A' <template>: <n> sibling(s): <slug> (fork), <slug>, …`, `B  <n> page(s): …`, `passthrough <n> page(s): …`.
 *   Then the encode attempt (encode-attempt.mjs) of every template with A' siblings in the set — the attempt
 *   decides how a template's siblings are built, so an A page without siblings and a B page get none: an existing
 *   record (any verdict) is kept, --force re-records — except an automatic not-attempted (no map / no encoder, no
 *   reason given), which is always recorded again, so a map drafted since is picked up; else recordAttempt runs the
 *   encoder (encode.mjs beside encode-attempt.mjs; --encoder <file> names another, a missing one is a usage error)
 *   and writes stardust/migrate/encode/<template>.json under the project root (the cwd). Encoder first: a template
 *   with ≥ 2 siblings (the state's, plus this set's) and no map is refused a not-attempted record — its stderr line
 *   is encode-attempt.mjs's refusal, nothing is written (an earlier automatic record goes), and after the per-template
 *   lines one stdout line names them all: `maps due: <k> template(s) — <t> (<n> siblings), … — draft each map in
 *   the C-archetype unit (…), or record why not: … --reason "<why>"`; with --force, a decision on record (a reason,
 *   hand-authored) is kept when the re-record would be refused. One line per template
 *   `encode-attempt <t>: <verdict> — <reason or roundtrip line>`, with ` (kept from <at>; --force re-records)`
 *   when kept; a template name the record cannot take, or a record that cannot be written, is one stderr line
 *   `encode-attempt <t>: not recorded — <why>`. The LAST stdout line is the count for the plan unit's ledger
 *   detail: `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted, <h> hand-authored)`, plus ` · <k>
 *   without a record` (a recorded hands-off run never invoked the encoder and hand-built every sibling). Exit 2 when a
 *   page is refused or a template is left without a record.
 *
 * Encode-attempt gate (every A' page, own file or fork; before the sidecar and variance checks): the template (the
 *   archetype's slug) needs an attempt record, stardust/migrate/encode/<template>.json under the project root, that
 *   encode-attempt.mjs reads as valid — any verdict (encoded, no-roundtrip, not-attempted, hand-authored): the gate is that the
 *   attempt was made, not that it encoded. None (or an invalid one) → refused, nothing written, `refused <slug>:
 *   strict encode-attempt — template <t> has no encode attempt record (stardust/migrate/encode/<t>.json) — run: node
 *   stardust/scripts/migrate/encode-attempt.mjs record --template <t>` (migrate.mjs plan records it too). A and B
 *   pages are never checked.
 *
 * A' fork (template-and-module-rendering.md § Path A′; data-attributes.md § Slot identity): the
 *   archetype's source HTML is copied in-process and every `data-slot` inside its <main> takes
 *   this page's value from <current>/pages/<slug>.json#slots (prep-mode.md § 4) — an object
 *   { name: value } or an array of { name, …value } / { name, value }. A value is a string (text,
 *   escaped) | { text } | { html } (inner HTML verbatim) | { src, alt?, srcset? } (an image: on
 *   <img> it sets src / alt / srcset, alt and srcset removed when the value has none; on a
 *   container its first <img>, and the container's <source> elements are removed) | { href,
 *   text? } (a link: on <a> href + text, the text kept when absent; on a container its first <a>)
 *   | an array of those (a repeated slot: successive elements of that name; more values clone the
 *   last element after it, fewer remove the rest; a single value is a list of one) | null (the
 *   page has none: the element is removed, decision slot-empty). Outermost slots first: slots
 *   nested in replaced content go with it; inside a kept container (an image / link value) they
 *   are filled next. Slots derived: an archetype with no data-slot inside its <main> (the strict-slots
 *   check's own test) is not refused — deriveSlots marks its content units in-process from its section
 *   structure (the prototype file is never written): per section (a top-level element of <main> as
 *   data-section counts them — first class, else tag; a repeated name numbered -2 …) each heading,
 *   phrasing-only p li dt dd figcaption blockquote td th caption or link with text, and each image (a
 *   <picture> for its <img>), the outermost such element, named `<section>-<tag>` — units of one tag at the
 *   same structure (the tag.class chain from the section) share the name, the next structure takes -2 …;
 *   the values come by those names from either slot source below; one run line per archetype `slots
 *   derived (no data-slot markers): archetype <a> — <n> slot(s): <names> — mark them in the prototype …`
 *   and the driver decision slots-derived { archetype, slots }. Refused (strict slots): no data-slot
 *   inside the archetype's <main> and none derived (the fork would carry the archetype's own content —
 *   mark the typed slots, or pass --source); a slot
 *   name with no key in slots (every missing name listed); a value its element cannot take.
 *   Head: <title> ← the capture's title (emptied when absent → strict metadata), meta
 *   description ← metaDescription || description (removed when neither), the archetype's
 *   canonical, hreflang alternate links, og:*, twitter:* and every application/ld+json script
 *   removed, <html lang> ← language || lang (capture text placed verbatim, escaped). Media in
 *   slot values and inserted HTML (the archetype's own media stay; in
 *   inserted HTML only src / srcset on <img> <source> <video> <audio> and poster on <video> —
 *   any other element's URLs are left as is) resolve against the capture's finalUrl || url,
 *   then: a --media-map entry (default
 *   <current>/assets/media-map.json) with status ok and an existing local file → that file
 *   relative to --proto-dir (bundled to <out>/assets/ like any asset); else a --media-ledger
 *   record (default <dirname(state)>/deploy/media-ledger.json; keyed by DA path, or { entries })
 *   with status uploaded and that source → its contentUrl; else the source URL is kept and a
 *   media-unmapped decision recorded. Driver decisions: slots-derived, archetype-fork, slot-empty, slot-unused
 *   (values no element took), media-unmapped; the provenance comment adds a sourceForked row. A
 *   malformed media map or ledger refuses the page.
 *
 * Fork slot source (--slots mapping|page-json). Default: page-json when <dirname(state)>/rollout/workspace/mapping.json is
 *   absent; mapping when it is usable (below), has a verified selector for the archetype and both captures exist; else
 *   page-json, never silently — one run line per archetype and reason `slots: archetype <a> — mapping not used
 *   (<reason>); page JSON slots` and the sidecar slotMapSkipped <reason>. An explicit --slots mapping refuses instead.
 *   page-json: the page JSON slots above. mapping (slot-map.mjs): the rollout block mapping (the rollout skill's
 *   coverage-contract.md § mapping), read only when rollout/workspace/manifest.json lists its sha256 under outputs
 *   and its generatedAt equals rollout/coverage/pages.json's. Each data-slot of the archetype's <main> is found in the
 *   archetype's capture (<current>/pages/<archetype>.html) inside an anchor of the archetype — a block instance verified
 *   true, or a section that resolved on it — by its text (an image by its file name, a link by its text); the same anchor
 *   and child path on this page's capture (<current>/pages/<slug>.html) give its value (<img> image, <a> link, block
 *   children html, else text). A name in the page JSON slots keeps that value (explicit beats derived); the page JSON is
 *   never written. Refused (strict slots, nothing written): with an explicit --slots mapping, the mapping unusable (the
 *   reason; re-run block-origin.mjs --verify, or --slots page-json), no verified selector for the archetype or a missing
 *   capture; in mapping mode, a slot without a mapped source (or with an ambiguous one: its text in separate places of
 *   the archetype's mapped capture, its image file name on more than one image there), or whose anchor does not match
 *   exactly one element of this page's capture, whose path leads nowhere, whose link has no text, or a repeated slot
 *   with more items than the archetype's, and no page JSON value for it. sourceForked names the mapping and the capture.
 *
 * Variance gate (every A' page, own file or fork): <variance-dir>/<archetype-slug>.json, the
 *   replica/sibling-variance.mjs record (--variance-dir, default <dirname(state)>/rollout/variance).
 *   No file, or no row for the page → sidecar variance { status: skipped, reason } and one run
 *   summary line `variance: <n> A′ page(s) rendered without a variance probe row — recorded as
 *   skipped (…)`; verdict same → recorded; differs → refused (strict variance) unless
 *   --accept-variance "<reason>" (every differing page of this run; recorded as accepted; a new
 *   reason replaces an earlier one) or an earlier acceptance of the same row holds: the page's
 *   previous sidecar `variance` (else, with no sidecar record, its row's source.variance in
 *   <dirname(state)>/rollout/coverage/pages.json, read once per run) carries `accepted` and equals
 *   this render's record on archetype, verdict, missing, extra, deltas (the count) and deltaKinds
 *   (the deltas' fingerprint, sorted: each kind, with its probe when it names one, and its message
 *   — `COUNT(card): 3 → 4 matches`, so a grown COUNT, CLUSTERS or SECTIONS delta is a changed row;
 *   SECTION HEIGHTS and PROBE keep the kind and probe only, their pixel and style values move
 *   between probes), lists in any order → rendered without the flag,
 *   `accepted` (and `acceptedAt` when the earlier record has one) kept, one run summary line
 *   `variance: <n> A′ page(s) rendered on an earlier acceptance of an unchanged variance (…)`; a
 *   changed row — or an earlier record without archetype / deltaKinds, or whose deltaKinds lack
 *   the messages (refused once) — is refused naming each changed field and quoting the earlier
 *   reason. More than half
 *   of the archetype's current clones differ → refused even with --accept-variance or an earlier
 *   acceptance (`<d> of <t> current clone(s)`). A current clone is a row whose slug is a state page that clones
 *   this archetype now, resolved as the branch is: --archetype <slug>=<a>, else its representative,
 *   else (none) the archetype's type and not the archetype itself; rows of other slugs (moved to a
 *   sub-archetype, not in the state) count on neither side. Re-type the template: sub-archetypes by
 *   locale family or composition (state.mjs set <slug…> --representative <archetype-slug>, then
 *   probe the new template); the re-typing is recorded as a deviation (migrate.mjs decision <slug>
 *   --kind re-type …, or deviation), never a mechanical clone. A malformed variance file refuses
 *   the page. The refusal of a differing page names the share (`<d> of <t> current clone(s) differ`): a single one,
 *   or fewer than 20 % → `a variant class on the template, not a new archetype — …, re-run with --accept-variance
 *   "<the delta and its variant class>", then node stardust/scripts/migrate/migrate.mjs variant <slug>
 *   <variant-class>` (never a re-type for a few pages); 20 % up to half → --accept-variance with a variant class, or
 *   the re-type above.
 *
 * Writes:
 *   <out>/<output-path>              the migrated HTML (URL-literal rule; default stardust/migrated/)
 *   <out>/<dir>/_meta.json           sidecar next to index.html; <name>._meta.json next to <name>.html
 *                                    (`variance`: null on A / B, the variance record on A'; `slotSource`: mapping |
 *                                    page-json on a fork, else null; `slotMap`: { mapping, generatedAt, anchors,
 *                                    slots: { name: anchor selector } } of the mapped values, else null;
 *                                    `slotMapSkipped`: why a default fork did not use the mapping, else null);
 *                                    a re-render carries the recorded judgments, encode.mjs's
 *                                    `encode` / `audit` keys and `passedOn` over (sourceCurrentSha stays
 *                                    this script's)
 *   <out>/assets/**                  every bundled asset (copied only when missing or changed)
 *   state.json.migrate               MERGED, never replaced: this script owns at, outputDir,
 *                                    selfContained, pageMap[], totalAssetsBundled, bundledAssets[],
 *                                    pages[], missingAssets[], cleanedAssets[], lastRun; any other
 *                                    key already in `migrate` (e.g. generators) is kept as is. No
 *                                    other top-level key is touched.
 *   gate/deviation/decision/variant/modules rewrite one sidecar (a malformed sidecar is a usage
 *   error naming the file, not overwritten); harness rewrites the archetype's sidecar (passedOn)
 *   only when the record changes; summary and pagemap write nothing.
 *   stardust/migrate/encode/<t>.json  plan only: the template's encode attempt record (encode-attempt.mjs --help)
 * Exit: 0 clean · 2 any page refused, a template left without an encode attempt record (plan), the flow guard or a
 *   refused harness record · 1 usage error (message on stderr).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsFor, readMapping, slotRecipes, slotValues as mappedSlotValues } from './slot-map.mjs';
import { attemptLine, isAutoNotAttempted, readAttempt, recordAttempt, Refusal as AttemptRefusal, requireEncodeAttempt, siblingsOf, summaryLine, UsageError as AttemptUsageError } from './encode-attempt.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
// Only the main-module check below calls it: importing this module never prints or exits.
function help() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
}

export const DRIVER_VERSION = '1';
export const DEFAULTS = { state: 'stardust/state.json', protoDir: 'stardust/prototypes', current: 'stardust/current', out: 'stardust/migrated', canonCss: null };
export const RENDERABLE = new Set(['approved', 'migrated', 'directed']);
// asset-bundling.md § Prefix resolution — the default set, longest first.
export const ASSET_PREFIXES = ['../current/assets/', '../../../assets/', '../../assets/', '../assets/', './assets/', '/assets/', 'assets/'];
const SKIP_SCHEMES = /^(#|mailto:|tel:|javascript:|data:)/i;
// `encode` / `audit` are written by encode.mjs (encode/provenance.mjs creates a sidecar in this key order when none exists);
// `passedOn` (the archetype's) by `harness`
export const SIDECAR_KEYS = ['slug', 'type', 'renderBranch', 'template', 'modules', 'slotsFilled', 'canonShas', 'deviations', 'migrationDecisions', 'metadata', 'jsonLd', 'migratedAt', 'designMdSha', 'designJsonSha', 'sourceCurrentSha', 'sourceProposedSha',
  'fidelityTier', 'archetypeSource', 'archetypeSha', 'variants', 'gatesPassed', 'gateEvidence', 'contentDeviations', 'assetsBundled', 'missingAssets', 'brokenInternalLinks', 'outputPath', 'outputPathDefault', 'sidecar', 'driverVersion', 'encode', 'audit', 'passedOn', 'variance', 'slotSource', 'slotMap', 'slotMapSkipped'];
const CARRIED = ['gatesPassed', 'gateEvidence', 'variants', 'contentDeviations', 'deviations', 'encode', 'audit', 'passedOn'];
// The encode-attempt records live under the project root — the cwd, where encode-attempt.mjs's record command runs too.
const PROJECT_ROOT = '.';
const SELF = fileURLToPath(import.meta.url);

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 1; } }
// A strict refusal: the page is not written, other pages continue, the run exits 2.
export class Refusal extends Error { constructor(slug, rule, what, fix) { super(`refused ${slug}: strict ${rule} — ${what} — ${fix}`); this.slug = slug; } }
// The whole run is refused before any page (exit 2): the project is not ready to migrate.
export class RunRefusal extends Error {}

// ---- io helpers ---------------------------------------------------------------------------------
export const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
export const fsha = (file) => (file && existsSync(file) && statSync(file).isFile() ? sha(readFileSync(file)) : null);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split('\\').join('/');
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function writeIfChanged(dst, data) {
  if (existsSync(dst) && Buffer.compare(readFileSync(dst), Buffer.from(data)) === 0) return false;
  mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, data); return true;
}

// ---- output path mapping (migration-procedure.md § Output path mapping) -------------------------
export const pathnameOf = (url, origin = 'https://origin.invalid') => { try { return new URL(url, origin).pathname || '/'; } catch { return String(url).startsWith('/') ? url : `/${url}`; } };
export function outputPathFor(urlOrPath) {
  const p = urlOrPath.startsWith('/') && !urlOrPath.startsWith('//') ? urlOrPath : pathnameOf(urlOrPath);
  const bare = p.replace(/^\/+/, '');
  if (bare === '') return { outputPath: 'index.html', outputPathDefault: null, passthrough: false };
  if (p.endsWith('/')) return { outputPath: `${bare}index.html`, outputPathDefault: null, passthrough: false };
  const leaf = bare.split('/').pop();
  if (/\.html?$/i.test(leaf)) return { outputPath: bare, outputPathDefault: null, passthrough: false };
  if (/\.[a-z0-9]+$/i.test(leaf)) return { outputPath: bare, outputPathDefault: null, passthrough: true };
  return { outputPath: `${bare}/index.html`, outputPathDefault: 'trailing-slash', passthrough: false };
}
export const sidecarFor = (outputPath) => { const d = posix.dirname(outputPath); const b = posix.basename(outputPath); const s = b === 'index.html' ? '_meta.json' : `${b.replace(/\.html?$/i, '')}._meta.json`; return d === '.' ? s : `${d}/${s}`; };
export const depthOf = (outputPath) => outputPath.split('/').length - 1;
export const relPrefix = (depth) => (depth === 0 ? './' : '../'.repeat(depth));
export const urlFormOf = (outputPath) => outputPath.replace(/(^|\/)index\.html$/, '$1');
// The AEM-Edge-safe form of an output path, as delivery-lint's path-safety normalises a DA path: lowercase,
// per segment `_`, spaces and anything outside [a-z0-9.] → `-`, runs of `-` collapsed, no leading/trailing `-`.
// Two pages whose folded paths coincide would overwrite each other once delivered, whatever their literal case.
export const foldPath = (outputPath) => outputPath.toLowerCase().split('/').filter(Boolean)
  .map((seg) => seg.replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')).join('/');

// The page map — every state page, built once per run; strict 8 refuses colliding slugs. `collisions` is keyed by
// the FOLDED output path (literal collisions fold to the same key), value = every slug that lands on it.
export function buildPageMap(pages, originUrl) {
  const entries = []; const bySlug = new Map(); const byPath = new Map(); const seen = new Map(); const collisions = new Map();
  for (const page of pages) {
    const sourceUrl = pathnameOf(page.url, originUrl || undefined);
    const o = outputPathFor(sourceUrl);
    const e = { sourceUrl, outputPath: o.outputPath, folded: foldPath(o.outputPath), slug: page.slug, outputPathDefault: o.outputPathDefault, passthrough: o.passthrough };
    entries.push(e); bySlug.set(page.slug, e); byPath.set(sourceUrl, e);
    if (seen.has(e.folded)) { const list = collisions.get(e.folded) || [seen.get(e.folded)]; list.push(page.slug); collisions.set(e.folded, list); } else seen.set(e.folded, page.slug);
  }
  return { entries, bySlug, byPath, collisions };
}
export const lookupPath = (byPath, p) => byPath.get(p) || byPath.get(p.endsWith('/') ? p.slice(0, -1) : `${p}/`) || null;

// ---- internal links (content-preservation.md § Internal link rewriting; shape per migration-procedure.md) ----
export const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
export function stripTracking(search) {
  if (!search || search === '?') return '';
  const kept = search.slice(1).split('&').filter((kv) => kv && !/^(utm_[^=]*|gclid|fbclid)(=|$)/i.test(kv));
  return kept.length ? `?${kept.join('&')}` : '';
}
const isSchemeRef = (p) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(p);
export const matchPrefix = (p) => ASSET_PREFIXES.find((x) => p.startsWith(x)) || null;
// → { kind: 'skip' | 'external' | 'internal', pathname, search, hash }
export function classifyHref(href, { base, originHosts }) {
  if (!href || SKIP_SCHEMES.test(href)) return { kind: 'skip' };
  let u; try { u = new URL(href, base); } catch { return { kind: 'skip' }; }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'skip' };
  if (!originHosts.has(normHost(u.host))) return { kind: 'external' };
  if (matchPrefix(u.pathname)) return { kind: 'skip' }; // an asset href — the bundling pass owns it
  return { kind: 'internal', pathname: u.pathname, search: stripTracking(u.search), hash: u.hash };
}
// ctx: { base, originHosts, origin, byPath, depth, available(entry) }. Returns { html, links, broken[] }.
export function rewriteLinks(html, ctx) {
  const prefix = relPrefix(ctx.depth); const broken = []; let links = 0;
  const out = html.replace(/<(a|area)\b([^>]*)>/gi, (m, tag, attrs) => {
    const hm = attrs.match(/(?<![\w-])href\s*=\s*(["'])(.*?)\1/s);
    if (!hm) return m;
    const raw = hm[2]; const hadAmp = raw.includes('&amp;'); const href = raw.replace(/&amp;/g, '&').trim();
    const c = classifyHref(href, ctx);
    if (c.kind !== 'internal') return m;
    links += 1;
    const entry = lookupPath(ctx.byPath, c.pathname); let next; let reason = null;
    if (entry && ctx.available(entry)) next = `${prefix}${entry.outputPath}${c.search}${c.hash}`;
    else if (entry) { next = `${ctx.origin}${c.pathname}${c.search}${c.hash}`; reason = 'in-inventory-not-migrated'; } // partial-inventory carve-out
    else { next = `${prefix}${outputPathFor(c.pathname).outputPath}${c.search}${c.hash}`; reason = 'not-in-inventory'; }
    if (reason) broken.push({ href, reason });
    let a = attrs.replace(hm[0], () => `href=${hm[1]}${hadAmp ? next.replace(/&/g, '&amp;') : next}${hm[1]}`);
    if (reason && !/(?<![\w-])data-broken-link=/.test(a)) a += ' data-broken-link="true"';
    return `<${tag}${a}>`;
  });
  return { html: out, links, broken };
}

// ---- <main>: data-template + data-section (attributes only; markup is never reordered) --------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'title']); // never a section; contents skipped
export function tagSections(main, template) {
  const open = main.match(/^<main\b([^>]*)>/i);
  if (!open) return null;
  let attrs = open[1].replace(/\s+$/, '');
  if (!/(?<![\w-])data-template=/.test(attrs)) attrs += ` data-template="${template}"`;
  const end = main.toLowerCase().lastIndexOf('</main>');
  const inner = main.slice(open[0].length, end < 0 ? main.length : end);
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let depth = 0; let n = 0; let out = ''; let last = 0; let m; const slots = [];
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('<!--')) continue;
    const [full, close, tagRaw, a, self] = m; const tag = tagRaw.toLowerCase();
    if (close) { if (depth > 0) depth -= 1; continue; }
    if (RAW.has(tag)) { if (!self) { const c = inner.toLowerCase().indexOf(`</${tag}>`, re.lastIndex); if (c >= 0) re.lastIndex = c + tag.length + 3; } continue; }
    if (depth === 0) {
      n += 1;
      const cls = a.match(/(?<![\w-])class\s*=\s*(["'])(.*?)\1/s);
      slots.push(cls && cls[2].trim() ? cls[2].trim().split(/\s+/)[0] : tag);
      if (!/(?<![\w-])data-section=/.test(a)) { out += `${inner.slice(last, m.index)}<${tagRaw}${a.replace(/\s+$/, '')} data-section="${n}"${self}>`; last = m.index + full.length; }
    }
    if (!VOID.has(tag) && !self) depth += 1;
  }
  return { html: `<main${attrs}>${out}${inner.slice(last)}</main>`, slots, sections: n };
}
export const modulesIn = (main) => [...new Set([...main.matchAll(/(?<![\w-])data-module\s*=\s*(["'])(.*?)\1/gs)].map((x) => x[2].trim()).filter(Boolean))];

// ---- assets (asset-bundling.md § Detection / Prefix resolution / Copy / Rewrite / Edge cases) ------
export const splitRef = (ref) => { const m = ref.match(/^([^?#]*)(.*)$/s); return { path: m[1], suffix: m[2] }; };
export function rewriteCssUrls(css, fn) {
  return css.replace(/url\(\s*(["']?)([^)"'\s]+)\1\s*\)/g, (m, q, ref) => { const r = fn(ref); return r == null ? m : `url(${q}${r}${q})`; });
}
export class Bundler {
  constructor({ protoDir, currentDir, outDir, seed = [] }) {
    Object.assign(this, { protoDir: resolve(protoDir), currentDir: resolve(currentDir), outDir: resolve(outDir) });
    this.bundled = new Set(seed); this.done = new Set(); this.copied = 0; this.page = null;
  }
  begin(report) { this.page = report; } // per page: { refs:Set, missing:[], traversal:[] }
  // Which known root holds this file → its subpath under assets/ (one leading assets/ stripped).
  subpathUnder(abs) {
    for (const root of [join(this.protoDir, 'assets'), this.protoDir, join(this.currentDir, 'assets'), join(this.outDir, 'assets')]) {
      const rel = relative(root, abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return toPosix(rel);
    }
    return null;
  }
  // A reference is bundled when it matches a default prefix, or (protoRelative) is a relative path
  // that resolves against baseDir to an existing file under a known root. → { subpath, candidates } | null
  resolveRef(refPath, baseDir, protoRelative) {
    if (!refPath || isSchemeRef(refPath)) return null;
    const decoded = safeDecode(refPath); const prefix = matchPrefix(refPath); let subpath; const candidates = [];
    if (prefix) {
      subpath = safeDecode(refPath.slice(prefix.length));
      if (!decoded.startsWith('/')) candidates.push(resolve(baseDir, decoded));
      candidates.push(join(this.protoDir, decoded.replace(/^\/+/, '')), join(this.protoDir, 'assets', subpath));
    } else if (protoRelative && !refPath.startsWith('/')) {
      const abs = resolve(baseDir, decoded);
      if (!isFile(abs)) return null;
      subpath = this.subpathUnder(abs); if (subpath == null) return null;
      candidates.push(abs);
    } else return null;
    if (!subpath || subpath.startsWith('/') || subpath.split('/').includes('..')) return { traversal: refPath };
    candidates.push(join(this.currentDir, 'assets', subpath), join(this.outDir, 'assets', subpath));
    return { subpath, candidates };
  }
  // Copy (or rewrite, for CSS) into <out>/assets/<subpath>; false when no source exists.
  ensure(subpath, candidates) {
    const dst = join(this.outDir, 'assets', subpath);
    if (this.done.has(subpath)) return true;
    const src = candidates.find((c) => isFile(c));
    if (!src) return false;
    this.done.add(subpath); this.bundled.add(subpath);
    if (resolve(src) === dst) return true;
    if (/\.css$/i.test(subpath)) {
      const css = this.rewriteCss(readFileSync(src, 'utf8'), dirname(src), subpath);
      if (writeIfChanged(dst, css)) this.copied += 1;
    } else if (!existsSync(dst) || Buffer.compare(readFileSync(src), readFileSync(dst)) !== 0) {
      mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); this.copied += 1;
    }
    return true;
  }
  // One reference → its rewritten form (or null = leave as is), recording refs/missing/traversal on the page.
  rewriteRef(ref, baseDir, protoRelative, toNew) {
    const { path, suffix } = splitRef(ref.trim());
    const r = this.resolveRef(path, baseDir, protoRelative);
    if (!r) return null;
    if (r.traversal) { this.page?.traversal.push(ref); return null; }
    if (!this.ensure(r.subpath, r.candidates)) { this.page?.missing.push({ ref, subpath: r.subpath }); return null; }
    this.page?.refs.add(r.subpath);
    return toNew(r.subpath) + suffix;
  }
  // url() inside a CSS file: resolved against the file's OLD dir, rewritten relative to its NEW location.
  rewriteCss(css, oldDir, newSubpath) {
    const newDir = posix.dirname(`assets/${newSubpath}`);
    return rewriteCssUrls(css, (ref) => this.rewriteRef(ref, oldDir, true, (s) => posix.relative(newDir, `assets/${s}`)));
  }
  // The five HTML shapes on a page at `depth`: src/href/poster, srcset, inline style, <style> blocks.
  rewriteHtml(html, depth) {
    const prefix = relPrefix(depth);
    const toNew = (s) => `${prefix}assets/${s}`;
    const one = (ref, protoRelative) => this.rewriteRef(ref, this.protoDir, protoRelative, toNew);
    const css = (text) => rewriteCssUrls(text, (ref) => one(ref, true));
    let out = html.replace(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g, (m, tag, attrs) => {
      if (!attrs) return m;
      const link = /^(a|area)$/i.test(tag); // page links: only a prefixed href is an asset here
      const a = attrs.replace(/(?<![\w-])(src|href|poster|srcset|style)\s*=\s*(["'])(.*?)\2/gs, (mm, name, q, val) => {
        let next = null;
        if (name === 'srcset') next = val.split(/(\s*,\s*)/).map((part, i) => { if (i % 2) return part; const [u, ...d] = part.trim().split(/\s+/); if (!u) return part; const r = one(u, true); return r == null ? part : [r, ...d].join(' '); }).join('');
        else if (name === 'style') next = val.includes('url(') ? css(val) : null;
        else next = one(val, !(link && name === 'href'));
        return next == null || next === val ? mm : `${name}=${q}${next}${q}`;
      });
      return a === attrs ? m : `<${tag}${a}>`;
    });
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, o, text, c) => `${o}${css(text)}${c}`);
    return out;
  }
}

// ---- <head> (metadata-and-jsonld.md; migration-procedure.md § Provenance, § :root block) -----------
export const rootBlockOf = (css) => { const m = css.match(/:root\s*\{[^}]*\}/); return m ? m[0] : null; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tagWith = (html, tag, test) => (html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || []).find((t) => test.test(t)) || null;
const attrOf = (tag, name) => { const m = tag && tag.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*(["'])(.*?)\\1`, 's')); return m ? m[2] : null; };
export function provenanceComment(f) {
  const line = (k, v) => `  ${`${k}:`.padEnd(17)} ${v}`;
  const rows = [line('writtenBy', 'stardust:migrate'), line('writtenAt', f.at), line('page', f.title), line('slug', f.slug), line('pagePath', f.pagePath), line('renderBranch', f.branch)];
  if (f.branch === "A'") rows.push(line('template', f.template), line('archetypePath', f.archetypePath), line('archetypeSha', f.archetypeSha));
  if (f.sourceForked) rows.push(line('sourceForked', f.sourceForked));
  if (f.branch === 'A') rows.push(line('sourceProposed', f.sourceProposed));
  rows.push(line('sourceCurrent', f.sourceCurrent), line('againstDirection', f.direction), line('designMd', `DESIGN.md (sha: ${f.designMdSha})`), line('designJson', `DESIGN.json (sha: ${f.designJsonSha})`),
    line('canonShas', `header:${f.canonShas.header} footer:${f.canonShas.footer} css:${f.canonShas.css}`), line('decisionTrace', f.decisionTrace), line('brokenInternalLinks', String(f.broken)), line('stardustVersion', f.stardustVersion));
  return `<!-- stardust:migrate\n${rows.join('\n')}\n-->`;
}
// Resolves title / description / canonical / lang / JSON-LD against the capture, rewrites canonical +
// og:url to the deploy host when set, and inserts the provenance + :root <style> (+ defaults) first. Capture text and URLs reach
// the HTML through function replacers only, so a `$&` / `$1` / `$$` in a title stays verbatim.
export function composeHead(html, h) {
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (!headOpen) return null;
  const tm = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  let title = tm ? tm[1].trim() : '';
  const inserts = [];
  if (!title && h.capture?.title) { title = String(h.capture.title).trim(); if (tm) html = html.replace(tm[0], () => `<title>${esc(title)}</title>`); else inserts.push(`<title>${esc(title)}</title>`); }
  const descTag = tagWith(html, 'meta', /(?<![\w-])name\s*=\s*["']description["']/i);
  let description = attrOf(descTag, 'content');
  if (description == null && h.capture?.metaDescription) { description = String(h.capture.metaDescription); inserts.push(`<meta name="description" content="${esc(description)}">`); }
  let canonical = attrOf(tagWith(html, 'link', /(?<![\w-])rel\s*=\s*["']canonical["']/i), 'href');
  if (h.deployHost) {
    canonical = `https://${h.deployHost}/${urlFormOf(h.outputPath)}`;
    html = html.replace(/<link\b[^>]*>/gi, (m) => (/(?<![\w-])rel\s*=\s*["']canonical["']/i.test(m) ? m.replace(/((?<![\w-])href\s*=\s*["'])[^"']*/i, (x, pre) => `${pre}${canonical}`) : m));
    html = html.replace(/<meta\b[^>]*>/gi, (m) => (/(?<![\w-])property\s*=\s*["']og:url["']/i.test(m) ? m.replace(/((?<![\w-])content\s*=\s*["'])[^"']*/i, (x, pre) => `${pre}${canonical}`) : m));
    if (!tagWith(html, 'link', /(?<![\w-])rel\s*=\s*["']canonical["']/i)) inserts.push(`<link rel="canonical" href="${canonical}">`);
    if (!tagWith(html, 'meta', /(?<![\w-])property\s*=\s*["']og:url["']/i)) inserts.push(`<meta property="og:url" content="${canonical}">`);
  }
  const lang = (html.match(/<html\b[^>]*?(?<![\w-])lang\s*=\s*["']([^"']*)/i) || [])[1] || h.capture?.language || null;
  const existingLd = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  let jsonLd = null; let insertedLd = null;
  if (existingLd) { try { jsonLd = JSON.parse(existingLd[1]); } catch { jsonLd = existingLd[1].trim(); } } else {
    const url = canonical || h.pageUrl;
    insertedLd = h.type === 'article' ? { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: description ?? undefined, mainEntityOfPage: url }
      : { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: description ?? undefined, url };
    jsonLd = JSON.parse(JSON.stringify(insertedLd));
  }
  const parts = [h.prov, `<style>\n${h.rootBlock}${h.inlineCss ? `\n${h.inlineCss}` : ''}\n</style>`];
  if (h.canonLink) parts.push(`<link rel="stylesheet" href="${h.canonLink}">`);
  if (insertedLd) parts.push(`<script type="application/ld+json">${JSON.stringify(insertedLd)}</script>`);
  const at = headOpen.index + headOpen[0].length;
  return { html: `${html.slice(0, at)}\n${[...parts, ...inserts].join('\n')}${html.slice(at)}`, metadata: { title, description: description ?? null, canonical: canonical ?? null, lang }, jsonLd };
}
// Strict validation on the final string, before anything is written (migration-procedure.md § Validation).
export function validatePage(slug, html, sidecar, outDir, refs) {
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1] ?? '';
  const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  if (!firstStyle || !firstStyle[1].trim().startsWith(':root')) throw new Refusal(slug, 1, ':root block is not first in the first <style>', 'the source must not open a <style> before <head>');
  if (!/<main\b[^>]*\sdata-template=/i.test(html) || !/(?<![\w-])data-section=/.test(html)) throw new Refusal(slug, 2, 'data-template / data-section missing', 'the source needs a <main> with at least one element child');
  if (!/^\s*<!-- stardust:migrate/.test(head)) throw new Refusal(slug, 3, 'provenance comment is not the first child of <head>', 'the source needs a plain <head> element');
  if (!sidecar.metadata.title) throw new Refusal(slug, 'metadata', '<title> is empty and the capture has no title', 'add a <title> to the source');
  try { JSON.parse(JSON.stringify(sidecar)); } catch (e) { throw new Refusal(slug, 7, `sidecar does not round-trip (${e.message})`, 'check the recorded judgments for non-JSON values'); }
  for (const s of refs) if (!isFile(join(outDir, 'assets', s))) throw new Refusal(slug, 'asset', `bundled reference assets/${s} is not on disk`, 'check the file under --proto-dir or --current');
}

// ---- A' fork: the archetype's HTML with this page's typed slots (template-and-module-rendering.md § Path A′) ----
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const FORK_MARK = 'data-stardust-fork'; // transient: kept | done on a processed slot, stripped before the fork returns
// Elements of an HTML fragment in document order: { tag, attrs, start, openEnd, closeStart, end, parent }. Comments and
// raw-text contents are skipped; a stray close tag is ignored; an element still open at its parent's close ends there.
export function elementsOf(html) {
  const re = new RegExp(TAG_RE.source, 'g'); const lower = html.toLowerCase(); const out = []; const stack = []; let m;
  const shut = (e, closeStart, end) => { e.closeStart = closeStart; e.end = end; };
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const [full, close, tagRaw, attrs, self] = m; const tag = tagRaw.toLowerCase();
    if (close) {
      let i = stack.length - 1; while (i >= 0 && stack[i].tag !== tag) i -= 1;
      if (i < 0) continue;
      while (stack.length > i + 1) { const e = stack.pop(); shut(e, m.index, m.index); }
      shut(stack.pop(), m.index, m.index + full.length); continue;
    }
    const e = { tag, attrs, start: m.index, openEnd: m.index + full.length, closeStart: null, end: null, parent: stack[stack.length - 1] || null };
    out.push(e);
    if (VOID.has(tag) || self) { shut(e, e.openEnd, e.openEnd); continue; }
    if (RAW.has(tag)) {
      const c = lower.indexOf(`</${tag}`, re.lastIndex); const ce = c < 0 ? -1 : lower.indexOf('>', c);
      if (ce < 0) { shut(e, html.length, html.length); re.lastIndex = html.length; } else { shut(e, c, ce + 1); re.lastIndex = ce + 1; }
      continue;
    }
    stack.push(e);
  }
  for (const e of stack) shut(e, html.length, html.length);
  return out;
}
const attrValue = (attrs, name) => { const m = attrs.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i')); return m ? (m[1] ?? m[2] ?? m[3]).trim() : null; };
export const slotNameOf = (attrs) => attrValue(attrs, 'data-slot') || null;
// Attribute spans of an open tag, so one attribute is replaced or removed without reformatting the others.
function attrSpans(open) {
  const spans = []; const re = /(\s+)([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/y;
  let i = open.match(/^<[a-zA-Z][\w:-]*/)[0].length;
  for (;;) { re.lastIndex = i; const x = re.exec(open); if (!x) break; spans.push({ name: x[2].toLowerCase(), start: i, end: re.lastIndex }); i = re.lastIndex; }
  return spans;
}
// value null removes the attribute.
export function setAttr(open, name, value) {
  const spans = attrSpans(open); const hit = spans.find((s) => s.name === name); const next = value == null ? '' : ` ${name}="${esc(value)}"`;
  if (hit) return open.slice(0, hit.start) + next + open.slice(hit.end);
  if (value == null) return open;
  const at = spans.length ? spans[spans.length - 1].end : open.match(/^<[a-zA-Z][\w:-]*/)[0].length;
  return open.slice(0, at) + next + open.slice(at);
}
const splice = (s, edits) => [...edits].sort((a, b) => b[0] - a[0]).reduce((acc, [from, to, repl]) => acc.slice(0, from) + repl + acc.slice(to), s);
// prep-mode.md § 4: { name: value } or [{ name, …value }] → Map name → list of values (a single value is a list of one, null none).
export function slotValues(slots) {
  const map = new Map(); const bad = [];
  if (Array.isArray(slots)) {
    slots.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim()) { bad.push(`slots[${i}] (an entry without a name)`); return; }
      const { name, ...rest } = entry; const v = 'value' in rest ? rest.value : rest;
      const list = map.get(name.trim()) || []; if (Array.isArray(v)) list.push(...v); else if (v !== null) list.push(v); map.set(name.trim(), list);
    });
  } else if (slots && typeof slots === 'object') {
    for (const [name, v] of Object.entries(slots)) map.set(name, Array.isArray(v) ? v : v === null ? [] : [v]);
  }
  return { map, bad };
}
function slotKind(v) {
  if (v === null) return 'none';
  if (typeof v === 'string' || typeof v === 'number') return 'text';
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'bad';
  if (typeof v.html === 'string') return 'html';
  if (typeof v.src === 'string' && v.src.trim()) return 'image';
  if (typeof v.href === 'string' && v.href.trim()) return 'link';
  if (typeof v.text === 'string' || typeof v.text === 'number') return 'text';
  return 'bad';
}
// One media reference of a slot value → { ref, unmapped }: the media map's local file (relative to --proto-dir, when the
// Bundler can place it), else the ledger's contentUrl, else the absolute source URL kept (unmapped = that URL).
export function mediaRefFor(ref, { base, map, ledger, protoDir, bundles }) {
  const raw = String(ref).trim();
  if (!raw || /^(data:|blob:|#)/i.test(raw)) return { ref: raw, unmapped: null };
  let u; try { u = new URL(raw, base || undefined); } catch { return { ref: raw, unmapped: raw }; }
  if (!/^https?:$/.test(u.protocol)) return { ref: raw, unmapped: null };
  u.hash = ''; const key = u.href; const m = map?.[key];
  if (m && m.status === 'ok' && typeof m.local === 'string' && isFile(m.local)) {
    const rel = toPosix(relative(resolve(protoDir), resolve(m.local)));
    if (!bundles || bundles(rel)) return { ref: rel, unmapped: null };
  }
  const c = ledger?.get(key);
  return c ? { ref: c, unmapped: null } : { ref: key, unmapped: key };
}
// The media ledger (deploy/da-media-upload.mjs): an object keyed by DA path, or { entries } → Map source URL → contentUrl.
export function ledgerIndex(raw) {
  const table = raw && raw.entries && typeof raw.entries === 'object' ? raw.entries : raw; const out = new Map();
  const recs = !table || typeof table !== 'object' ? [] : Array.isArray(table) ? table : Object.keys(table).sort().map((k) => table[k]);
  for (const r of recs) {
    if (!r || r.status !== 'uploaded' || typeof r.source !== 'string' || typeof r.contentUrl !== 'string') continue;
    try { const u = new URL(r.source); u.hash = ''; if (!out.has(u.href)) out.set(u.href, r.contentUrl); } catch { /* not a URL — cannot match a source */ }
  }
  return out;
}
// The fork's <head>: title / description / lang from the capture; the archetype's canonical, hreflang alternates, og:*, twitter:*
// and JSON-LD go (composeHead re-adds canonical / og:url / the default JSON-LD for this page). Capture text reaches the head through
// function replacers only, so a `$&` / `$'` / `$$` in it stays verbatim.
export function forkHead(html, capture) {
  const c = capture || {}; const line = (t) => new RegExp(`[ \\t]*<${t}\\b(?:[^>"']|"[^"]*"|'[^']*')*>[ \\t]*\\r?\\n?`, 'gi');
  html = html.replace(/[ \t]*<script\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script>[ \t]*\r?\n?/gi, (m) => (/^\s*<script\b[^>]*?type\s*=\s*["']?application\/ld\+json/i.test(m) ? '' : m));
  const ho = html.match(/<head\b(?:[^>"']|"[^"]*"|'[^']*')*>/i); const hc = html.search(/<\/head>/i);
  if (ho && hc > ho.index) {
    let head = html.slice(ho.index + ho[0].length, hc);
    head = head.replace(line('link'), (m) => {
      const rel = (attrValue(m, 'rel') || '').toLowerCase().split(/\s+/);
      return rel.includes('canonical') || (rel.includes('alternate') && attrValue(m, 'hreflang') !== null) ? '' : m;
    });
    head = head.replace(line('meta'), (m) => (/^(og|twitter):/i.test(attrValue(m, 'property') || attrValue(m, 'name') || '') ? '' : m));
    const title = c.title == null ? '' : String(c.title).trim();
    head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => `<title>${esc(title)}</title>`);
    const desc = c.metaDescription || c.description || null; let placed = false;
    head = head.replace(line('meta'), (m) => {
      if ((attrValue(m, 'name') || '').toLowerCase() !== 'description') return m;
      if (!desc || placed) return '';
      placed = true; return m.replace(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/i, () => `<meta name="description" content="${esc(desc)}">`);
    });
    if (desc && !placed) head = `${head.replace(/\s*$/, '')}\n<meta name="description" content="${esc(desc)}">\n`;
    html = html.slice(0, ho.index + ho[0].length) + head + html.slice(hc);
  }
  const lang = c.language || c.lang;
  if (lang) html = html.replace(/<html\b(?:[^>"']|"[^"]*"|'[^']*')*>/i, (m) => setAttr(m, 'lang', String(lang)));
  return html;
}
// ---- derived slots: an archetype prototype without data-slot marks (replica recreation-procedure.md § Slot markers) ----
const SLOT_PHRASING = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 'picture', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup', 'svg', 'time', 'u', 'var', 'wbr']);
const TEXT_UNITS = new Set(['p', 'li', 'dt', 'dd', 'figcaption', 'blockquote', 'td', 'th', 'caption']);
const slotToken = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
// When no element inside <main> carries data-slot (the strict-slots check's own test, on the same element model), every
// content unit gets one: per section (a top-level element of <main> as tagSections counts them — first class, else tag; a
// repeated name numbered -2, -3 …) each heading, paragraph-like element (p li dt dd figcaption blockquote td th caption)
// or link holding only phrasing content and some text, each image (a <picture> for the <img> in it) — the outermost such
// element; any other element is walked into (never script, style, template or svg). Name `<section>-<tag>`; units of one
// tag share it while they sit at the same structure (the tag.class chain from the section down), the next structure gets
// -2, -3 … — so cards repeat as one slot. A section that is itself a unit is named by the section. Only data-slot
// attributes are added. → { html, slots: [names sorted], derived } — derived false (html as given) when a mark exists.
export function deriveSlots(html) {
  const mi = html.search(/<main\b/i); const mj = html.toLowerCase().lastIndexOf('</main>');
  const open = mi >= 0 && mj > mi ? html.slice(mi).match(/^<main\b(?:[^>"']|"[^"]*"|'[^']*')*>/i) : null;
  if (!open) return { html, slots: [], derived: false };
  const start = mi + open[0].length; const inner = html.slice(start, mj); const els = elementsOf(inner);
  if (els.some((e) => slotNameOf(e.attrs))) return { html, slots: [], derived: false };
  const kids = new Map(); for (const e of els) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }
  const below = (e) => { const out = []; const walk = (x) => { for (const k of kids.get(x) || []) { out.push(k); if (k.tag !== 'svg') walk(k); } }; walk(e); return out; };
  const hasText = (e) => !!inner.slice(e.openEnd, e.closeStart).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s+/g, '');
  const hasImg = (e) => below(e).some((d) => d.tag === 'img');
  const isUnit = (e) => {
    if (/^h[1-6]$/.test(e.tag)) return hasText(e) || hasImg(e);
    if (e.tag === 'picture') return hasImg(e);
    if (e.tag === 'img') return e.parent?.tag !== 'picture';
    if (e.tag === 'a') return below(e).every((d) => SLOT_PHRASING.has(d.tag) && d.tag !== 'img') && hasText(e);
    return TEXT_UNITS.has(e.tag) && below(e).every((d) => SLOT_PHRASING.has(d.tag)) && (hasText(e) || hasImg(e));
  };
  const step = (e) => { const c = (attrValue(e.attrs, 'class') || '').split(/\s+/).filter(Boolean)[0]; return c ? `${e.tag}.${c}` : e.tag; };
  const edits = []; const names = new Set(); const seen = new Map();
  for (const sec of (kids.get(null) || []).filter((e) => !RAW.has(e.tag))) {
    const base = slotToken((attrValue(sec.attrs, 'class') || '').split(/\s+/).filter(Boolean)[0] || sec.tag);
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const secName = n > 1 ? `${base}-${n}` : base; const shapes = new Map();
    const visit = (e, chain) => {
      if (RAW.has(e.tag) || e.tag === 'svg') return;
      if (isUnit(e)) {
        let name = secName;
        if (e !== sec) {
          const list = shapes.get(e.tag) || []; shapes.set(e.tag, list);
          let k = list.indexOf(chain.join('>')); if (k < 0) k = list.push(chain.join('>')) - 1;
          name = `${secName}-${e.tag}${k ? `-${k + 1}` : ''}`;
        }
        edits.push([e.start, e.openEnd, setAttr(inner.slice(e.start, e.openEnd), 'data-slot', name)]); names.add(name);
        return;
      }
      for (const c of kids.get(e) || []) visit(c, e === sec ? chain : [...chain, step(e)]);
    };
    visit(sec, []);
  }
  if (!edits.length) return { html, slots: [], derived: true };
  return { html: html.slice(0, start) + splice(inner, edits) + html.slice(mj), slots: [...names].sort(), derived: true };
}

// The A' fork (exported, pure but for resolveMedia): every data-slot inside the archetype's <main> takes this page's value.
// → { html, slots: [names placed], decisions: [_driver records] }; throws Refusal (strict slots) when it cannot.
export function forkFromArchetype(archetypeHtml, capture, { slug = 'page', archetype = 'archetype', capturePath = 'the capture', resolveMedia = null } = {}) {
  const base = capture?.finalUrl || capture?.url || null;
  const resolveRef = resolveMedia || ((ref) => mediaRefFor(ref, { base, map: null, ledger: null }));
  const headed = forkHead(archetypeHtml, capture); // the archetype's own JSON-LD goes before any slot HTML is inserted
  const mi = headed.search(/<main\b/i); const mj = headed.toLowerCase().lastIndexOf('</main>');
  const open = mi >= 0 && mj > mi ? headed.slice(mi).match(/^<main\b(?:[^>"']|"[^"]*"|'[^']*')*>/i) : null;
  let work = open ? headed.slice(mi + open[0].length, mj) : '';
  if (!elementsOf(work).some((e) => slotNameOf(e.attrs))) throw new Refusal(slug, 'slots', `archetype ${archetype} has no data-slot inside <main> and none derive from its sections (no heading, paragraph, list item, link or image with content), so a fork would carry the archetype's own content`, `mark its typed slots (stardust/reference/data-attributes.md § Slot identity), or pass --source ${slug}=<file>`);
  const { map: values, bad: badEntries } = slotValues(capture?.slots);
  const placed = new Set(); const missing = new Set(); const problems = [...badEntries]; const empty = new Set(); const unmapped = new Set();
  const media = (ref) => { const r = resolveRef(ref); if (r.unmapped) unmapped.add(r.unmapped); return r.ref; };
  const srcset = (s) => String(s).split(',').map((part) => { const [u, ...d] = part.trim().split(/\s+/); return u ? [media(u), ...d].join(' ') : ''; }).filter(Boolean).join(', ');
  const MEDIA_TAGS = new Set(['img', 'source', 'video', 'audio']); // other elements' URLs (an <iframe src>, say) are not media
  const mapHtml = (h) => h.replace(/<([a-zA-Z][\w-]*)(\s(?:[^>"']|"[^"]*"|'[^']*')*)?>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!attrs || !MEDIA_TAGS.has(t)) return m;
    return `<${tag}${attrs.replace(/(?<![\w-])(src|srcset|poster)\s*=\s*(["'])(.*?)\2/gis, (mm, n, q, val) => {
      const name = n.toLowerCase(); if (name === 'poster' && t !== 'video') return mm;
      const raw = val.replace(/&amp;/g, '&'); const next = name === 'srcset' ? srcset(raw) : media(raw);
      return next === raw ? mm : `${n}=${q}${esc(next)}${q}`;
    })}>`;
  });
  const imgAttrs = (o, v) => {
    o = setAttr(setAttr(o, 'src', media(v.src)), 'alt', v.alt == null ? null : String(v.alt));
    return v.srcset ? setAttr(o, 'srcset', srcset(v.srcset)) : setAttr(setAttr(o, 'srcset', null), 'sizes', null);
  };
  // One slot element of `src` filled with one value → its new outer HTML ('' = removed); a slot that cannot take its value is
  // recorded as a problem (the fork is refused) and marked done so the loop moves on.
  const fill = (src, e, v, name) => {
    const open0 = src.slice(e.start, e.openEnd); const inner = src.slice(e.openEnd, e.closeStart); const close = src.slice(e.closeStart, e.end);
    const mark = (o, how) => setAttr(o, FORK_MARK, how);
    const kind = slotKind(v); const label = `<${e.tag}>`;
    const bad = (why) => { problems.push(`${name} (${why})`); return mark(open0, 'done') + inner + close; };
    if (kind === 'none') { empty.add(name); return ''; }
    if (kind === 'bad') return bad('unsupported value');
    if (kind === 'text' || kind === 'html') {
      if (VOID.has(e.tag) || !close) return bad(`${kind} value on ${label}${VOID.has(e.tag) ? '' : ' without a closing tag'}`);
      return mark(open0, 'done') + (kind === 'text' ? esc(typeof v === 'object' ? v.text : v) : mapHtml(v.html)) + close;
    }
    const want = kind === 'image' ? 'img' : 'a';
    if (e.tag === want) {
      if (kind === 'image') return mark(imgAttrs(open0, v), 'done');
      const o = setAttr(open0, 'href', v.href);
      if (v.text == null) return mark(o, 'kept') + inner + close;
      return close ? mark(o, 'done') + esc(v.text) + close : bad(`link text on ${label} without a closing tag`);
    }
    const kids = elementsOf(inner); const k = kids.find((x) => x.tag === want);
    if (!k) return bad(`${kind} value on ${label} without an <${want}>`);
    const kOpen = inner.slice(k.start, k.openEnd); const kClose = inner.slice(k.closeStart, k.end);
    if (kind === 'link' && v.text != null && !kClose) return bad(`link text on the <a> in ${label} without a closing tag`);
    const edits = kind === 'image'
      ? [[k.start, k.openEnd, imgAttrs(kOpen, v)], ...kids.filter((x) => x.tag === 'source').map((x) => [x.start, x.end, ''])]
      : [[k.start, k.end, setAttr(kOpen, 'href', v.href) + (v.text == null ? inner.slice(k.openEnd, k.closeStart) : esc(v.text)) + kClose]];
    return mark(open0, 'kept') + splice(inner, edits) + close;
  };
  // Outermost first: each pass fills the slots whose slot ancestors are all kept containers (an image / link value);
  // slots under replaced content (done) are inserted HTML or gone, never filled.
  const markOf = (attrs) => attrValue(attrs, FORK_MARK);
  const ready = (e) => { for (let p = e.parent; p; p = p.parent) if (slotNameOf(p.attrs) && markOf(p.attrs) !== 'kept') return false; return true; };
  for (let pass = 0; pass < 64; pass += 1) {
    const cands = elementsOf(work).filter((e) => slotNameOf(e.attrs) && !markOf(e.attrs) && ready(e));
    if (!cands.length) break;
    const groups = new Map(); for (const e of cands) { const n = slotNameOf(e.attrs); if (!groups.has(n)) groups.set(n, []); groups.get(n).push(e); }
    const edits = [];
    for (const [name, els] of groups) {
      if (!values.has(name)) { missing.add(name); for (const e of els) edits.push([e.start, e.end, '']); continue; }
      placed.add(name); const list = values.get(name);
      if (!list.length) empty.add(name);
      els.forEach((e, i) => {
        const parts = [i < list.length ? fill(work, e, list[i], name) : ''];
        if (i === els.length - 1 && list.length > els.length) {
          const proto = work.slice(e.start, e.end);
          for (const v of list.slice(els.length)) parts.push(fill(proto, elementsOf(proto)[0], v, name));
        }
        const out = parts.filter(Boolean).join((work.slice(0, e.start).match(/\s*$/) || [''])[0]); // clones keep the indentation
        edits.push([out ? e.start : e.start - ((work.slice(0, e.start).match(/\r?\n[ \t]*$/) || [''])[0].length), e.end, out]);
      });
    }
    work = splice(work, edits);
  }
  if (missing.size) throw new Refusal(slug, 'slots', `${capturePath}#slots has no value for slot(s) ${[...missing].sort().join(', ')} of archetype ${archetype}`, `add each name to slots (null when the page has none; extract/reference/prep-mode.md § 4), or pass --source ${slug}=<file>`);
  if (problems.length) throw new Refusal(slug, 'slots', `slot value(s) the archetype ${archetype} cannot take: ${problems.join('; ')}`, `fix the value in ${capturePath}#slots or the archetype's markup, or pass --source ${slug}=<file>`);
  work = work.replace(new RegExp(` ${FORK_MARK}="(?:kept|done)"`, 'g'), '');
  const html = headed.slice(0, mi) + open[0] + work + headed.slice(mj);
  const slots = [...placed].sort(); const unused = [...values.keys()].filter((n) => !placed.has(n) && !missing.has(n)).sort();
  const decisions = [{ kind: 'archetype-fork', archetype, slots, _driver: true }, ...[...empty].sort().map((slot) => ({ kind: 'slot-empty', slot, _driver: true }))];
  if (unused.length) decisions.push({ kind: 'slot-unused', slots: unused, _driver: true });
  for (const ref of [...unmapped].sort()) decisions.push({ kind: 'media-unmapped', ref, _driver: true });
  return { html, slots, decisions };
}

// ---- render branch and canon ---------------------------------------------------------------------
export function sourceFor(run, page) {
  const explicit = run.sources.get(page.slug);
  if (explicit) return explicit;
  if (page.prototypePath && isFile(page.prototypePath)) return page.prototypePath;
  return join(run.protoDir, `${page.slug}-proposed.html`);
}
// The archetype a state page names, in chooseBranch's order: --archetype <slug>=<a>, else its representative (never itself);
// null = none named (the branch then falls back to the page's type).
export const namedArchetype = (run, page) => run.archetypes.get(page.slug) || (page.representative && page.representative !== page.slug ? page.representative : null);
// approved/migrated → A; --branch-b → B; directed → A' of its archetype (--archetype, else page.representative, else the single
// approved/migrated page of its type with a source file): from its own source file, or forked from the archetype's.
export function chooseBranch(run, page) {
  const source = sourceFor(run, page); const own = isFile(source);
  const noSource = () => new Refusal(page.slug, 'source', `no source HTML at ${source}`, 'pass --source <slug>=<file> or build the page first');
  if (run.branchB.has(page.slug)) { if (!own) throw noSource(); return { branch: 'B', tier: 'thin', archetype: null, source, fork: false }; }
  if (page.status !== 'directed') { if (!own) throw noSource(); return { branch: 'A', tier: 'archetype', archetype: null, source, fork: false }; }
  if (run.sources.has(page.slug) && !own) throw noSource(); // a named --source that is missing is a mistake, never a fork
  const flagged = run.archetypes.get(page.slug); const named = namedArchetype(run, page);
  let archetype = null;
  if (named) {
    archetype = run.bySlug.get(named);
    if (!archetype) throw new Refusal(page.slug, 'branch', `${flagged ? '--archetype' : 'the state representative'} names ${named}, which is not a page in ${toPosix(run.stateFile)}`, `name an approved page of type ${page.type} (--archetype ${page.slug}=<archetype-slug>, or state.mjs set ${page.slug} --representative <archetype-slug>)`);
  } else {
    const c = run.pages.filter((p) => p.slug !== page.slug && p.type === page.type && ['approved', 'migrated'].includes(p.status) && isFile(sourceFor(run, p)));
    if (c.length !== 1) throw new Refusal(page.slug, 'branch', `${c.length} archetype candidate(s) of type ${page.type}${c.length ? ` (${c.map((p) => p.slug).join(', ')})` : ''}`, `--archetype ${page.slug}=<archetype-slug> (or --branch-b ${page.slug} for a one-off render)`);
    archetype = c[0];
  }
  const archetypeSource = sourceFor(run, archetype);
  if (!isFile(archetypeSource)) throw new Refusal(page.slug, 'source', `archetype ${archetype.slug} has no proposed HTML at ${toPosix(archetypeSource)}`, `build the archetype's prototype first or pass --source ${archetype.slug}=<file> (or name another archetype with --archetype ${page.slug}=<archetype-slug>)`);
  const fork = !own || !!run.fromArchetype;
  return { branch: "A'", tier: 'sibling', archetype, source: fork ? archetypeSource : source, fork };
}
export function resolveCanon(o) {
  const dflt = join(dirname(o.state), 'canon', 'canon.css');
  let file = o.canonCss;
  if (file) { if (!isFile(file)) throw new UsageError(`--canon-css ${file} does not exist`); } else if (isFile(dflt)) file = dflt; else {
    const c = existsSync(o.protoDir) ? readdirSync(o.protoDir).filter((f) => /canon.*\.css$/i.test(f)) : [];
    if (c.length !== 1) throw new UsageError(`no canon CSS: ${dflt} is absent and ${o.protoDir} has ${c.length} *canon*.css file(s) — pass --canon-css <file>`);
    file = join(o.protoDir, c[0]);
  }
  const css = readFileSync(file, 'utf8'); const rootBlock = rootBlockOf(css);
  if (!rootBlock) throw new UsageError(`${file} has no :root{…} block (strict 1) — pass --canon-css <file> whose first block is the canon :root`);
  const rel = relative(resolve(o.protoDir), resolve(file));
  const subpath = rel && !rel.startsWith('..') && !isAbsolute(rel) ? toPosix(rel).replace(/^assets\//, '') : basename(file);
  return { file: resolve(file), css, rootBlock, sha: sha(css), subpath };
}

// ---- one page ----------------------------------------------------------------------------------
export function renderPage(run, page, entry) {
  const { slug } = page; const { outputPath, outputPathDefault } = entry;
  const { branch, tier, archetype, source, fork } = chooseBranch(run, page);
  // encode-attempt gate — every A' page, own file or fork: its template's attempt must be on record (any verdict)
  if (branch === "A'") {
    const missing = requireEncodeAttempt(PROJECT_ROOT, archetype.slug);
    if (missing) throw new Refusal(slug, 'encode-attempt', `template ${archetype.slug} has no encode attempt record (stardust/migrate/encode/${archetype.slug}.json)`, missing.slice(missing.indexOf('run: ')));
  }
  const outFile = join(run.outDir, outputPath); const sideRel = sidecarFor(outputPath); const sideFile = join(run.outDir, sideRel);
  const capturePath = join(run.currentDir, 'pages', `${slug}.json`); const capture = readJson(capturePath);
  const archetypeSource = archetype ? sourceFor(run, archetype) : null;
  const old = readJson(sideFile);
  if (old === null && isFile(sideFile)) throw new Refusal(slug, 'sidecar', `${toPosix(sideFile)} exists but is not valid JSON`, 'fix or delete the sidecar (its recorded judgments would be lost by overwriting), then re-run');
  // variance gate — every A' page, before its HTML is built (a refused page is never reported unchanged)
  const variance = branch === "A'" ? varianceGate(run, page, archetype, old) : null;
  let forked = null; let sourceHtml; let mapped = null; let slotPlan = null; let derivedSlots = null;
  if (fork) {
    let archetypeHtml = readFileSync(archetypeSource, 'utf8');
    // A prototype without data-slot marks: its slots derive from its section structure (deriveSlots) instead of a refusal.
    const derived = deriveSlots(archetypeHtml);
    if (derived.slots.length) { archetypeHtml = derived.html; derivedSlots = derived.slots; run.slotsDerived.set(archetype.slug, derived.slots); }
    slotPlan = slotSourceFor(run, page, archetype);
    if (slotPlan.mode === 'mapping') mapped = mappedSlots(run, page, archetype, archetypeHtml, capture, toPosix(capturePath));
    forked = forkFromArchetype(archetypeHtml, mapped ? { ...capture, slots: mapped.slots } : capture, { slug, archetype: archetype.slug, capturePath: toPosix(capturePath), resolveMedia: mediaResolver(run, slug, capture) });
    sourceHtml = forked.html;
  } else sourceHtml = readFileSync(source, 'utf8');
  const canonDir = join(dirname(run.stateFile), 'canon');
  const ownSlice = (tag) => { const m = sourceHtml.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i')); return m ? sha(m[0]) : null; };
  const canonShas = { header: fsha(join(canonDir, 'header.html')) ?? ownSlice('header'), footer: fsha(join(canonDir, 'footer.html')) ?? ownSlice('footer'), css: run.canon.sha };
  const keys = { designMdSha: run.designMdSha, designJsonSha: run.designJsonSha, sourceCurrentSha: fsha(capturePath), sourceProposedSha: sha(sourceHtml), canonShas, archetypeSha: archetype ? fsha(archetypeSource) : null, driverVersion: DRIVER_VERSION, variance,
    slotSource: slotPlan ? slotPlan.mode : null, slotMap: mapped ? mapped.record : null, slotMapSkipped: slotPlan ? slotPlan.skipped : null };
  // idempotent skip (migration-procedure.md § Idempotent skip) — the recorded input shas (and variance record, slot source) equal the current set
  if (!run.force && old && isFile(outFile) && JSON.stringify(Object.fromEntries(Object.keys(keys).map((k) => [k, old[k] ?? null]))) === JSON.stringify(keys)) return { status: 'unchanged', outputPath };
  // placeholder gate — no bypass flag
  if (/(?<![\w-])data-placeholder(?![\w-])/.test(sourceHtml)) throw new Refusal(slug, 'placeholder-gate', '[data-placeholder] present in the source', 'fill the missing content in the source file, then re-run');
  if (capture?._provenance?.unsourcedContent?.length) throw new Refusal(slug, 'placeholder-gate', `the capture lists ${capture._provenance.unsourcedContent.length} unsourced content item(s)`, 'source the content, re-extract, then re-run');
  // <main>: data-template + data-section
  const mi = sourceHtml.search(/<main\b/i); const mj = sourceHtml.toLowerCase().lastIndexOf('</main>');
  if (mi < 0 || mj < mi) throw new Refusal(slug, 2, 'no <main> element', 'wrap the page content in <main>');
  const template = branch === 'A' ? slug : branch === "A'" ? archetype.slug : (page.type || 'unique');
  const tagged = tagSections(sourceHtml.slice(mi, mj + 7), template);
  let html = sourceHtml.slice(0, mi) + tagged.html + sourceHtml.slice(mj + 7);
  const modules = modulesIn(tagged.html); const modulesOut = modules.length ? modules : (old?.modules?.length ? old.modules : []);
  const depth = depthOf(outputPath); const prefix = relPrefix(depth);
  // internal links via the page map
  let pageUrl; try { pageUrl = new URL(page.url, run.originUrl || 'https://origin.invalid').href; } catch { pageUrl = page.url; }
  const hosts = new Set(run.originHosts); try { hosts.add(normHost(new URL(pageUrl).host)); } catch { /* relative url — origin hosts only */ }
  const linked = rewriteLinks(html, { base: pageUrl, originHosts: hosts, origin: run.origin, byPath: run.pageMap.byPath, depth, available: run.available });
  html = linked.html;
  // assets (the canon CSS is bundled like any other asset unless --inline-canon)
  const report = { refs: new Set(), missing: [], traversal: [] }; run.bundler.begin(report);
  html = run.bundler.rewriteHtml(html, depth);
  let canonLink = null;
  if (!run.inlineCanon && !report.refs.has(run.canon.subpath)) { run.bundler.ensure(run.canon.subpath, [run.canon.file]); report.refs.add(run.canon.subpath); canonLink = `${prefix}assets/${run.canon.subpath}`; }
  // <head>
  const at = nowIso();
  const prov = provenanceComment({ at, title: String(page.title || slug).replace(/\s+/g, ' ').replace(/--/g, '-'), slug, pagePath: posix.join(basename(run.outDir), outputPath), branch, template: archetype?.slug, archetypePath: archetypeSource && toPosix(archetypeSource), archetypeSha: keys.archetypeSha, sourceForked: forked ? (mapped ? `${toPosix(archetypeSource)} + ${mapped.record.mapping} on ${mapped.capture}${mapped.pageJson ? ` + ${toPosix(capturePath)}#slots` : ''}` : `${toPosix(archetypeSource)} + ${toPosix(capturePath)}#slots`) : null, sourceProposed: toPosix(source), sourceCurrent: toPosix(capturePath), direction: run.direction, designMdSha: run.designMdSha, designJsonSha: run.designJsonSha, canonShas, decisionTrace: posix.basename(sideRel), broken: linked.broken.length, stardustVersion: run.stardustVersion });
  const head = composeHead(html, { prov, rootBlock: run.canon.rootBlock, inlineCss: run.inlineCanon ? run.canon.css : null, canonLink, capture, deployHost: run.deployHost, outputPath, pageUrl, type: page.type });
  if (!head) throw new Refusal(slug, 3, 'no <head> element', 'add <head> to the source');
  html = head.html;
  // sidecar: spec keys first, then the tier/judgment fields; recorded judgments are carried over
  const carried = (old?.migrationDecisions || []).filter((d) => !(d && d._driver));
  const driverDecisions = [...report.missing.map((m) => ({ kind: 'asset-missing', ref: m.ref, subpath: m.subpath, _driver: true })), ...report.traversal.map((ref) => ({ kind: 'asset-path-traversal', ref, _driver: true }))];
  const derivedRec = derivedSlots ? [{ kind: 'slots-derived', archetype: archetype.slug, slots: derivedSlots, _driver: true }] : [];
  const meta = { slug, type: page.type ?? null, renderBranch: branch, template: archetype ? archetype.slug : null, modules: modulesOut, slotsFilled: tagged.slots, canonShas, migrationDecisions: [...carried, ...derivedRec, ...(forked ? forked.decisions : []), ...driverDecisions], metadata: head.metadata, jsonLd: head.jsonLd, migratedAt: at, ...keys,
    fidelityTier: tier, archetypeSource: archetype ? archetype.slug : null, assetsBundled: report.refs.size, missingAssets: report.missing, brokenInternalLinks: linked.broken, outputPath, outputPathDefault, sidecar: sideRel };
  const defaults = { gatesPassed: [], gateEvidence: {}, variants: [], contentDeviations: [], deviations: [] };
  for (const k of CARRIED) meta[k] = old?.[k] ?? defaults[k];
  const sidecar = Object.fromEntries(SIDECAR_KEYS.map((k) => [k, meta[k] ?? null]));
  validatePage(slug, html, sidecar, run.outDir, report.refs);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html); writeFileSync(sideFile, `${JSON.stringify(sidecar, null, 2)}\n`);
  return { status: 'rendered', branch, fork: forked ? archetype.slug : null, mapped: !!mapped, outputPath, type: page.type, assets: report.refs.size, links: linked.links, broken: linked.broken.length, sections: tagged.sections, missing: report.missing, modulesEmpty: modulesOut.length === 0, varianceSkipped: variance?.status === 'skipped', varianceHeld: variance?.verdict === 'differs' && !run.acceptVariance };
}
// The fork's slot source for a page → { mode: 'mapping' | 'page-json', skipped: reason | null }. --slots as given (an
// explicit mapping refuses in mappedSlots when unusable); by default the page JSON when there is no mapping file, the mapping
// when readMapping finds it usable, it has a verified selector for the archetype and both captures (the archetype's, this
// page's) exist, else the page JSON with the reason (sidecar slotMapSkipped, one run summary line per archetype and reason —
// never a silent fallback).
function slotSourceFor(run, page, archetype) {
  if (run.slotFlag) return { mode: run.slotFlag, skipped: null };
  if (!run.mappingPresent) return { mode: 'page-json', skipped: null };
  const m = run.mapping || (run.mapping = readMapping(run.rolloutDir));
  const archCapture = toPosix(join(run.currentDir, 'pages', `${archetype.slug}.html`)); const ownCapture = toPosix(join(run.currentDir, 'pages', `${page.slug}.html`));
  const skipped = !m.mapping ? m.reason : !anchorsFor(m.mapping, null, archetype.slug).length ? `${m.file} has no verified selector for archetype ${archetype.slug}`
    : !isFile(archCapture) ? `no capture HTML of archetype ${archetype.slug} at ${archCapture}` : !isFile(ownCapture) ? `no capture HTML at ${ownCapture}` : null;
  if (skipped) { if (!run.slotFallbacks.has(archetype.slug)) run.slotFallbacks.set(archetype.slug, new Set()); run.slotFallbacks.get(archetype.slug).add(skipped); }
  return { mode: skipped ? 'page-json' : 'mapping', skipped };
}
// --slots mapping (slot-map.mjs): this page's slot values read from its capture through the archetype's anchors in the rollout
// block mapping; a name in the page JSON slots keeps that value. → { slots (array form: the page JSON entries, then the mapped
// names), record (the sidecar slotMap), capture, pageJson (the page JSON has slots) }; throws Refusal (strict slots) when the
// mapping cannot be used or a slot gets no value. Recipes are built once per archetype source per run.
function mappedSlots(run, page, archetype, archetypeHtml, capture, capturePath) {
  const { slug } = page; const m = run.mapping || (run.mapping = readMapping(run.rolloutDir));
  if (!m.mapping) throw new Refusal(slug, 'slots', `the block mapping is unusable: ${m.reason}`, "re-run the rollout skill's block-origin.mjs --verify, then workspace-manifest.mjs, or pass --slots page-json");
  const archCapture = toPosix(join(run.currentDir, 'pages', `${archetype.slug}.html`)); const ownCapture = toPosix(join(run.currentDir, 'pages', `${slug}.html`));
  const anchors = anchorsFor(m.mapping, null, archetype.slug);
  if (!anchors.length) throw new Refusal(slug, 'slots', `${m.file} has no verified selector for archetype ${archetype.slug}`, `map the archetype with the rollout skill's block-origin.mjs --verify (its capture: ${archCapture}), or pass --slots page-json`);
  if (!isFile(archCapture)) throw new Refusal(slug, 'slots', `no capture HTML of archetype ${archetype.slug} at ${archCapture} to find its slots in`, 're-capture the archetype (extract), or pass --slots page-json');
  if (!isFile(ownCapture)) throw new Refusal(slug, 'slots', `no capture HTML at ${ownCapture} to read the mapped slots from`, 're-capture the page (extract), or pass --slots page-json');
  const key = `${archetype.slug}\n${sha(archetypeHtml)}`;
  if (!run.recipeCache.has(key)) run.recipeCache.set(key, slotRecipes(archetypeHtml, readFileSync(archCapture, 'utf8'), anchors));
  const recipes = run.recipeCache.get(key);
  const { slots: derived, unresolved } = mappedSlotValues(recipes, readFileSync(ownCapture, 'utf8'));
  const own = capture?.slots; const explicit = slotValues(own).map; const problems = [];
  for (const [name, r] of Object.entries(recipes)) { const none = (Array.isArray(r) ? r : [r]).find((x) => !x.anchor); if (none && !explicit.has(name)) problems.push(`${name} (no recipe: ${none.reason})`); }
  for (const u of unresolved) if (!explicit.has(u.slot)) problems.push(`${u.slot} (${u.reason})`);
  if (problems.length) throw new Refusal(slug, 'slots', `the block mapping gives no value for slot(s) ${problems.sort().join('; ')} of archetype ${archetype.slug}`, `add each name to ${capturePath}#slots (a page value wins over the mapped one), or pass --slots page-json`);
  const names = Object.keys(derived).filter((n) => !explicit.has(n)).sort();
  const entries = Array.isArray(own) ? [...own] : own && typeof own === 'object' ? Object.entries(own).map(([name, value]) => ({ name, value })) : [];
  for (const name of names) entries.push({ name, value: derived[name] });
  const anchorOf = (r) => { const sels = [...new Set((Array.isArray(r) ? r : [r]).map((x) => x.anchor))]; return sels.length === 1 ? sels[0] : sels; };
  return { slots: entries, capture: ownCapture, pageJson: explicit.size > 0, record: { mapping: m.file, generatedAt: m.generatedAt, anchors: anchors.length, slots: Object.fromEntries(names.map((n) => [n, anchorOf(recipes[n])])) } };
}
// The fork's media lookups: the media map and the ledger are read once per run, on the first slot value that names media.
function mediaSource(run, which, slug) {
  if (!(which in run.mediaCache)) {
    const file = which === 'map' ? run.mediaMap : run.mediaLedger; const v = isFile(file) ? readJson(file) : undefined;
    run.mediaCache[which] = v === undefined ? { value: null } : v && typeof v === 'object' && !Array.isArray(v) ? { value: which === 'map' ? v : ledgerIndex(v) } : { bad: toPosix(file) };
  }
  const c = run.mediaCache[which];
  if (c.bad) throw new Refusal(slug, `media-${which}`, `${c.bad} is not a JSON object`, `fix or delete it (or pass --media-${which} <file>), then re-run`);
  return c.value;
}
function mediaResolver(run, slug, capture) {
  const base = capture?.finalUrl || capture?.url || null;
  const bundles = (rel) => { const r = run.bundler.resolveRef(rel, run.bundler.protoDir, true); return !!(r && !r.traversal); };
  return (ref) => mediaRefFor(ref, { base, map: mediaSource(run, 'map', slug), ledger: mediaSource(run, 'ledger', slug), protoDir: run.protoDir, bundles });
}
// The variance gate (replica/sibling-variance.mjs record, <variance-dir>/<archetype-slug>.json) → the sidecar `variance` record:
// { status: 'skipped', reason } | { verdict, file, at, archetype, missing, extra, deltas, deltaKinds, accepted[, acceptedAt] }. Throws Refusal (strict
// variance) on a differing page without --accept-variance or an earlier acceptance of the unchanged row, on any page of a template
// whose current clones mostly differ, and on a malformed file.
export function varianceGate(run, page, archetype, old = null) {
  const file = join(run.varianceDir, `${archetype.slug}.json`); const rel = toPosix(file);
  if (!run.varianceCache.has(file)) run.varianceCache.set(file, isFile(file) ? readJson(file) : undefined);
  const doc = run.varianceCache.get(file);
  if (doc === undefined) return { status: 'skipped', reason: `no variance probe file ${rel}` };
  const rows = doc && typeof doc === 'object' && Array.isArray(doc.siblings) ? doc.siblings.filter((s) => s && typeof s === 'object') : null;
  if (!rows) throw new Refusal(page.slug, 'variance', `${rel} is not a variance probe record (no siblings[])`, `re-run replica/sibling-variance.mjs for archetype ${archetype.slug}, then re-run`);
  const row = rows.find((s) => s.slug === page.slug);
  if (!row) return { status: 'skipped', reason: `${rel} has no row for ${page.slug}` };
  const list = (v) => (Array.isArray(v) ? v : []);
  const rec = { verdict: row.verdict, file: rel, at: doc.at ?? null, archetype: archetype.slug, missing: list(row.missing), extra: list(row.extra), deltas: list(row.deltas).length, deltaKinds: deltaKindsOf(row.deltas), accepted: null };
  if (row.verdict === 'same') return rec;
  if (row.verdict !== 'differs') throw new Refusal(page.slug, 'variance', `${rel} gives ${page.slug} the verdict ${JSON.stringify(row.verdict ?? null)} (same or differs expected)`, `re-run replica/sibling-variance.mjs for archetype ${archetype.slug}, then re-run`);
  // The majority counts the current clones only: rows whose page clones this archetype now (a row left behind by a page moved
  // to a sub-archetype, or by a slug no longer in the state, counts on neither side).
  const clones = rows.filter((s) => {
    const p = typeof s.slug === 'string' ? run.bySlug.get(s.slug) : null; if (!p) return false;
    const named = namedArchetype(run, p);
    return named ? named === archetype.slug : p.slug !== archetype.slug && p.type === archetype.type;
  });
  const differ = clones.filter((s) => s.verdict === 'differs').length;
  const retype = `sub-archetypes by locale family or composition (state.mjs set <slug…> --representative <archetype-slug>, then probe the new template with replica/sibling-variance.mjs); the re-typing is recorded as a deviation (migrate.mjs decision <slug> --kind re-type …, or deviation), never a mechanical clone`;
  if (differ * 2 > clones.length) throw new Refusal(page.slug, 'variance', `${differ} of ${clones.length} current clone(s) of archetype ${archetype.slug} differ in ${rel}, so the template does not hold for this group`, `re-type the template: ${retype}; --accept-variance does not unlock a majority`);
  if (run.acceptVariance) return { ...rec, accepted: run.acceptVariance };
  const prior = priorVariance(run, page.slug, old);
  const reason = prior && typeof prior.accepted === 'string' && prior.accepted.trim() ? prior.accepted : null;
  const changed = reason ? VARIANCE_FIELDS.filter((k) => varianceKey(prior[k]) !== varianceKey(rec[k])) : [];
  if (reason && !changed.length) return { ...rec, accepted: reason, ...(prior.acceptedAt != null ? { acceptedAt: prior.acceptedAt } : {}) };
  const shown = (v) => (Array.isArray(v) ? `[${v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}]` : v == null ? '(not recorded)' : String(v));
  const since = reason ? `; changed since an earlier render accepted it ("${reason}"): ${changed.map((k) => `${k} ${shown(prior[k])} → ${shown(rec[k])}`).join('; ')}` : '';
  // A single differing clone, or fewer than 20 % of them: a variant class on the template — never a new archetype for a few pages.
  const share = `${differ} of ${clones.length} current clone(s) differ`;
  const fix = differ <= 1 || differ * 5 < clones.length
    ? `${share}: a variant class on the template, not a new archetype — give the delta a variant class on the archetype's block, re-run with --accept-variance "<the delta and its variant class>", then node stardust/scripts/migrate/migrate.mjs variant ${page.slug} <variant-class>`
    : `${share}: check the clone against the archetype and re-run with --accept-variance "<reason>" (a variant class on the template), or re-type it: ${retype}`;
  throw new Refusal(page.slug, 'variance', `the variance probe (${rel}) found ${page.slug} differs from archetype ${archetype.slug}: missing [${rec.missing.join(', ')}], extra [${rec.extra.join(', ')}], ${rec.deltas} delta(s)${since}`, fix);
}
// An earlier render's acceptance holds while the probe row is unchanged on these fields (lists compared in any order): the
// archetype it was made against, and the deltas' fingerprint besides their count — a record without them never holds, and
// one whose fingerprint lacks the messages is refused once.
const VARIANCE_FIELDS = ['verdict', 'archetype', 'missing', 'extra', 'deltas', 'deltaKinds'];
// The deltas' fingerprint, sorted: each delta's kind, with its probe when it names one, and its message ("COUNT(card): 3 → 4
// matches") — the message carries the amount of a COUNT, CLUSTERS or SECTIONS delta, so a grown variance is a changed one.
// SECTION HEIGHTS and PROBE keep the kind (and probe) only: their messages carry pixel and style values that move between
// identical probes.
const MOVING_MESSAGES = new Set(['SECTION HEIGHTS', 'PROBE']);
const deltaKindsOf = (deltas) => (Array.isArray(deltas) ? deltas : []).map((d) => (d && typeof d === 'object'
  ? `${d.kind}${d.probe != null ? `(${d.probe})` : ''}${d.msg == null || MOVING_MESSAGES.has(d.kind) ? '' : `: ${d.msg}`}`
  : String(d))).sort();
const varianceKey = (v) => JSON.stringify(Array.isArray(v) ? v.map((x) => JSON.stringify(x)).sort() : v ?? null);
// The variance record an earlier render left: the page's previous sidecar `variance`, else (no sidecar record) its row's
// source.variance in <dirname(state)>/rollout/coverage/pages.json — the rollout inventory's verbatim copy, read once per run.
function priorVariance(run, slug, old) {
  const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isRecord(old?.variance)) return old.variance;
  if (!run.coverageVariance) {
    const doc = readJson(join(run.rolloutDir || join(dirname(run.stateFile), 'rollout'), 'coverage', 'pages.json'));
    run.coverageVariance = new Map((Array.isArray(doc?.pages) ? doc.pages : []).filter((p) => p && typeof p.slug === 'string' && isRecord(p.source?.variance)).map((p) => [p.slug, p.source.variance]));
  }
  return run.coverageVariance.get(slug) || null;
}

// ---- the run -----------------------------------------------------------------------------------
export function loadState(file) {
  if (!isFile(file)) throw new UsageError(`${file} does not exist — create it with state.mjs init --pages <url-file|-> after the crawl (or pass --state <file>)`);
  const state = readJson(file);
  if (!state || !Array.isArray(state.pages)) throw new UsageError(`${file} is not valid JSON with a pages[] array`);
  return state;
}
// The only key touched is `migrate`, and it is merged: keys this script does not own (generators, …) stay as they
// were; the parsed key order is kept and `migrate` is appended when new.
function writeMigrateBlock(file, state, block) {
  const prev = state.migrate && typeof state.migrate === 'object' && !Array.isArray(state.migrate) ? state.migrate : {};
  state.migrate = { ...prev, ...block };
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`); renameSync(tmp, file);
}
function directionLine(stateFile) {
  const f = toPosix(join(dirname(stateFile), 'direction.md'));
  if (!isFile(f)) return `${f} (absent)`;
  const m = readFileSync(f, 'utf8').match(/Active[^\n]*?(\d{4}-\d{2}-\d{2}T[\d:]{8}Z)/);
  return `${f} (Active${m ? ` ${m[1]}` : ''})`;
}
// state-machine.md § Flow keys: a project with state.json but no `flow` has not answered the two-flow question yet.
export function flowGuard(state, file) {
  if (typeof state.flow === 'string' && state.flow.trim()) return;
  throw new RunRefusal(`refused: ${toPosix(file)} has no top-level flow — stamp flow / flowChosenAt / flowSource before migrating (the master skill's routing does this: skills/stardust/SKILL.md § Routing → § Two migration flows — pick one, never mix; state-machine.md § Flow keys)`);
}
// The page set of render and plan: --all = every renderable page (a `skip` line for the others), else the named slugs.
function pageSet(o, pages, bySlug, cmd) {
  if (o.all) { const set = []; for (const p of pages) { if (RENDERABLE.has(p.status)) set.push(p.slug); else console.log(`skip ${p.slug}: status ${p.status}`); } return set; }
  const unknown = o.slugs.filter((s) => !bySlug.has(s));
  if (unknown.length) throw new UsageError(`unknown slug(s): ${unknown.join(', ')}`);
  if (!o.slugs.length) throw new UsageError(`${cmd} needs <slug…> or --all`);
  return [...new Set(o.slugs)];
}
const byStr = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
// plan (Phase 1): each page's branch as render chooses it, then per template with A′ siblings in the set its encode attempt
// (kept when recorded, unless --force), the count last. Writes the attempt records only.
export function planRun(o) {
  const state = loadState(o.state); const pages = state.pages; const bySlug = new Map(pages.map((p) => [p.slug, p]));
  flowGuard(state, o.state);
  if (o.encoder && !isFile(o.encoder)) throw new UsageError(`--encoder ${o.encoder} does not exist`);
  const set = pageSet(o, pages, bySlug, 'plan');
  const pageMap = buildPageMap(pages, state.site?.originUrl || null);
  const run = { stateFile: o.state, pages, bySlug, protoDir: o.protoDir, sources: new Map(Object.entries(o.sources || {})), archetypes: new Map(Object.entries(o.archetypes || {})), branchB: o.branchB instanceof Set ? o.branchB : new Set(o.branchB || []), fromArchetype: !!o.fromArchetype };
  const groups = { A: [], B: [], passthrough: [], refused: [] }; const siblings = new Map(); let nSiblings = 0;
  for (const slug of set) {
    if (pageMap.bySlug.get(slug).passthrough) { groups.passthrough.push(slug); continue; }
    let b;
    try { b = chooseBranch(run, bySlug.get(slug)); } catch (e) { if (!(e instanceof Refusal)) throw e; console.error(e.message); groups.refused.push(slug); continue; }
    if (b.branch !== "A'") { groups[b.branch].push(slug); continue; }
    if (!siblings.has(b.archetype.slug)) siblings.set(b.archetype.slug, []);
    siblings.get(b.archetype.slug).push(b.fork ? `${slug} (fork)` : slug); nSiblings++;
  }
  const templates = [...siblings.keys()].sort(byStr);
  console.log(`plan: ${set.length} page(s) — A ${groups.A.length} · A' ${nSiblings} on ${templates.length} template(s) · B ${groups.B.length} · passthrough ${groups.passthrough.length} · refused ${groups.refused.length}`);
  if (groups.A.length) console.log(`A  ${groups.A.length} page(s): ${groups.A.join(', ')}`);
  for (const t of templates) console.log(`A' ${t}: ${siblings.get(t).length} sibling(s): ${siblings.get(t).join(', ')}`);
  if (groups.B.length) console.log(`B  ${groups.B.length} page(s): ${groups.B.join(', ')}`);
  if (groups.passthrough.length) console.log(`passthrough ${groups.passthrough.length} page(s): ${groups.passthrough.join(', ')}`);
  const records = []; const due = [];
  for (const t of templates) {
    const prior = readAttempt(PROJECT_ROOT, t);
    // An automatic not-attempted (no map / no encoder) is recorded again: a map drafted since then is picked up.
    let kept = !o.force && prior && !isAutoNotAttempted(prior) ? prior : null;
    let rec = kept;
    if (!rec) {
      const sibs = [...new Set([...siblingsOf(state, t), ...siblings.get(t).map((s) => s.replace(/ \(fork\)$/, ''))])];
      try { rec = recordAttempt(PROJECT_ROOT, t, { ...(o.encoder ? { encoder: o.encoder } : {}), siblings: sibs }); } catch (e) {
        // --force on a template whose record is a decision (a reason, hand-authored) keeps that decision when nothing new can run
        if (e instanceof AttemptRefusal && prior && (prior.verdict === 'hand-authored' || (prior.verdict === 'not-attempted' && !isAutoNotAttempted(prior)))) rec = kept = prior;
        else if (e instanceof AttemptRefusal) { console.error(e.message); due.push(`${t} (${sibs.length} siblings)`); }
        else if (e instanceof AttemptUsageError) console.error(`encode-attempt ${t}: not recorded — ${e.message}`);
        else if (e.code) console.error(`encode-attempt ${t}: not recorded — could not write stardust/migrate/encode/${t}.json (${e.code})`);
        else throw e;
        if (!rec) { records.push(null); continue; }
      }
    }
    console.log(`${attemptLine(rec)}${kept ? ` (kept${kept.at ? ` from ${kept.at}` : ''}; --force re-records)` : ''}`);
    records.push(rec);
  }
  if (due.length) console.log(`maps due: ${due.length} template(s) — ${due.join(', ')} — draft each map in the C-archetype unit (stardust/import/<template>/vocabulary.json; migrate SKILL.md § Encoder first), or record why not: node stardust/scripts/migrate/encode-attempt.mjs record --template <template> --reason "<why>"`);
  console.log(summaryLine(records));
  return groups.refused.length || records.includes(null) ? 2 : 0;
}
export function renderRun(o) {
  const state = loadState(o.state); const pages = state.pages; const bySlug = new Map(pages.map((p) => [p.slug, p]));
  flowGuard(state, o.state);
  const originUrl = state.site?.originUrl || null;
  const pageMap = buildPageMap(pages, originUrl);
  let set = pageSet(o, pages, bySlug, 'render');
  const counts = { rendered: [], unchanged: [], refused: [], passthrough: [] };
  for (const [folded, slugs] of pageMap.collisions) for (const s of slugs) if (set.includes(s)) {
    const own = pageMap.bySlug.get(s).outputPath; const others = slugs.filter((x) => x !== s).map((x) => { const op = pageMap.bySlug.get(x).outputPath; return op === own ? x : `${x} (${op})`; });
    console.error(`refused ${s}: strict 8 — output path ${own} collides with ${others.join(', ')}${others.some((x) => x.includes('(')) || folded !== own ? ` once AEM-folded to ${folded}` : ''} — fix page.url of one of them`); counts.refused.push(s);
  }
  set = set.filter((s) => !counts.refused.includes(s));
  const canon = resolveCanon(o);
  for (const [flag, file] of [['media-map', o.mediaMap], ['media-ledger', o.mediaLedger]]) if (file && !isFile(file)) throw new UsageError(`--${flag} ${file} does not exist`);
  if (o.varianceDir && !existsSync(o.varianceDir)) throw new UsageError(`--variance-dir ${o.varianceDir} does not exist`);
  if (o.acceptVariance != null && !String(o.acceptVariance).trim()) throw new UsageError('--accept-variance needs a non-empty reason');
  if (o.slotSource != null && !['mapping', 'page-json'].includes(o.slotSource)) throw new UsageError(`--slots takes mapping or page-json (got ${o.slotSource})`);
  const rolloutDir = join(dirname(o.state), 'rollout');
  const renderSet = new Set(set.filter((s) => !pageMap.bySlug.get(s).passthrough));
  let origin = 'https://origin.invalid'; const originHosts = new Set();
  if (originUrl) { try { const u = new URL(originUrl); origin = u.origin; originHosts.add(normHost(u.host)); } catch { /* keep the placeholder origin */ } }
  let deployHost = null;
  if (state.site?.deployUrl) { try { deployHost = new URL(/^[a-z]+:\/\//i.test(state.site.deployUrl) ? state.site.deployUrl : `https://${state.site.deployUrl}`).host; } catch { deployHost = state.site.deployUrl; } }
  const bundler = new Bundler({ protoDir: o.protoDir, currentDir: o.current, outDir: o.out, seed: state.migrate?.bundledAssets || [] });
  const run = { stateFile: o.state, pages, bySlug, pageMap, bundler, canon, inlineCanon: o.inlineCanon, force: o.force, sources: new Map(Object.entries(o.sources || {})), archetypes: new Map(Object.entries(o.archetypes || {})), branchB: o.branchB instanceof Set ? o.branchB : new Set(o.branchB || []), protoDir: o.protoDir, currentDir: o.current, outDir: o.out, originUrl, origin, originHosts, deployHost,
    designMdSha: fsha('DESIGN.md'), designJsonSha: fsha('DESIGN.json'), direction: directionLine(o.state), stardustVersion: o.stardustVersion || process.env.STARDUST_VERSION || 'local',
    fromArchetype: !!o.fromArchetype, mediaMap: o.mediaMap || join(o.current, 'assets', 'media-map.json'), mediaLedger: o.mediaLedger || join(dirname(o.state), 'deploy', 'media-ledger.json'), mediaCache: {},
    acceptVariance: o.acceptVariance ? String(o.acceptVariance).trim() : null, varianceDir: o.varianceDir || join(dirname(o.state), 'rollout', 'variance'), varianceCache: new Map(),
    slotFlag: o.slotSource || null, mappingPresent: isFile(join(rolloutDir, 'workspace', 'mapping.json')), rolloutDir, mapping: null, recipeCache: new Map(), slotFallbacks: new Map(), slotsDerived: new Map(),
    available: (e) => isFile(join(o.out, e.outputPath)) || (renderSet.has(e.slug) && !e.passthrough) };
  const missing = []; const modulesEmpty = []; const rendered = new Map(); const varianceSkipped = []; const varianceHeld = [];
  for (const slug of set) {
    const page = bySlug.get(slug); const entry = pageMap.bySlug.get(slug);
    if (entry.passthrough) { console.log(`passthrough ${slug}: ${entry.outputPath} (non-HTML leaf; no render, no sidecar)`); counts.passthrough.push(slug); continue; }
    let r;
    try { r = renderPage(run, page, entry); } catch (e) { if (!(e instanceof Refusal)) throw e; console.error(e.message); counts.refused.push(slug); continue; }
    if (r.status === 'unchanged') { console.log(`unchanged ${slug} → ${r.outputPath}`); counts.unchanged.push(slug); continue; }
    counts.rendered.push(slug); rendered.set(slug, r);
    for (const m of r.missing) missing.push({ slug, ...m });
    if (r.modulesEmpty) modulesEmpty.push(slug);
    if (r.varianceSkipped) varianceSkipped.push(slug);
    if (r.varianceHeld) varianceHeld.push(slug);
    console.log(`${r.branch.padEnd(2)} ${slug} → ${r.outputPath}  (${r.type || 'untyped'}; ${r.fork ? `fork of ${r.fork}${r.mapped ? ' via the block mapping' : ''}; ` : ''}${r.assets} assets, ${r.links} links, ${r.broken} broken, ${r.sections} sections)`);
  }
  const prev = state.migrate || {}; const at = nowIso(); const outRel = toPosix(o.out).replace(/\/+$/, '');
  const pageRecs = new Map((prev.pages || []).map((p) => [p.slug, p]));
  for (const [slug, r] of rendered) pageRecs.set(slug, { slug, file: `${outRel}/${r.outputPath}`, assetsBundled: r.assets });
  const missRec = new Map((prev.missingAssets || []).map((m) => [m.subpath, new Set((m.referencedBy || []).filter((s) => !rendered.has(s)))]));
  for (const m of missing) { if (!missRec.has(m.subpath)) missRec.set(m.subpath, new Set()); missRec.get(m.subpath).add(m.slug); }
  writeMigrateBlock(o.state, state, { at, outputDir: `${outRel}/`, selfContained: true, pageMap: pageMap.entries.map(({ sourceUrl, outputPath, slug, outputPathDefault }) => ({ sourceUrl, outputPath, slug, outputPathDefault })),
    totalAssetsBundled: bundler.bundled.size, bundledAssets: [...bundler.bundled].sort(), pages: [...pageRecs.values()], missingAssets: [...missRec].filter(([, s]) => s.size).map(([subpath, s]) => ({ subpath, referencedBy: [...s].sort() })), cleanedAssets: prev.cleanedAssets || [], lastRun: { at, ...counts } });
  if (missing.length) console.log(`missing assets: ${missing.length} reference(s) left as is — ${[...new Set(missing.map((m) => m.subpath))].slice(0, 6).join(', ')}`);
  if (modulesEmpty.length) console.log(`modules[] empty on ${modulesEmpty.length} page(s) — migrate.mjs modules <slug> <id…> (${modulesEmpty.slice(0, 6).join(', ')})`);
  if (varianceSkipped.length) console.log(`variance: ${varianceSkipped.length} A′ page(s) rendered without a variance probe row — recorded as skipped (${varianceSkipped.slice(0, 6).join(', ')}${varianceSkipped.length > 6 ? ', …' : ''})`);
  if (varianceHeld.length) console.log(`variance: ${varianceHeld.length} A′ page(s) rendered on an earlier acceptance of an unchanged variance (${varianceHeld.slice(0, 6).join(', ')}${varianceHeld.length > 6 ? ', …' : ''})`);
  for (const [a, reasons] of [...run.slotFallbacks].sort(([x], [y]) => byStr(x, y))) for (const reason of [...reasons].sort(byStr)) console.log(`slots: archetype ${a} — mapping not used (${reason}); page JSON slots`);
  for (const [a, names] of [...run.slotsDerived].sort(([x], [y]) => byStr(x, y))) console.log(`slots derived (no data-slot markers): archetype ${a} — ${names.length} slot(s): ${names.slice(0, 24).join(', ')}${names.length > 24 ? ', …' : ''} — mark them in the prototype to name them (replica recreation-procedure.md § Slot markers)`);
  console.log(`rendered ${counts.rendered.length}, unchanged ${counts.unchanged.length}, refused ${counts.refused.length}, passthrough ${counts.passthrough.length} → ${outRel}/`);
  return counts.refused.length ? 2 : 0;
}

// ---- sidecar subcommands: judgments the driver cannot make ------------------------------------
function sidecarPath(o, slug) {
  const state = loadState(o.state); const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new UsageError(`unknown slug: ${slug}`);
  const { outputPath, passthrough } = outputPathFor(page.url || page.path || `/${slug}/`);
  if (passthrough) throw new UsageError(`${slug} is a passthrough leaf (${outputPath}); it has no sidecar`);
  const file = join(o.out, sidecarFor(outputPath));
  if (!isFile(file)) throw new UsageError(`${file} does not exist — render ${slug} first`);
  const sidecar = readJson(file);
  if (sidecar === null || typeof sidecar !== 'object' || Array.isArray(sidecar)) throw new UsageError(`${toPosix(file)} is not a valid JSON sidecar — fix or delete it before recording anything (it is never overwritten blindly)`);
  return { file, sidecar, state };
}
function saveSidecar(file, sidecar) { writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`); }
const pushUnique = (arr, v) => { const key = JSON.stringify(v); if (!arr.some((x) => JSON.stringify(x) === key)) arr.push(v); return arr; };
export function gateCmd(o, slug, gate) {
  if (!slug || !gate) throw new UsageError('gate <slug> <gate> [--evidence <text>]');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.gatesPassed = pushUnique(sidecar.gatesPassed || [], gate);
  sidecar.gateEvidence = sidecar.gateEvidence || {}; sidecar.gateEvidence[gate] = o.evidence || sidecar.gateEvidence[gate] || 'passed';
  saveSidecar(file, sidecar); console.log(`gate ${slug}: ${gate} (${sidecar.gatesPassed.length} passed)`); return 0;
}
export function deviationCmd(o, slug) {
  if (!slug || !o.kind || !o.reason) throw new UsageError('deviation <slug> --kind <k> --source <text> --target <text> --reason <why>');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.contentDeviations = pushUnique(sidecar.contentDeviations || [], { kind: o.kind, source: o.source || null, target: o.target || null, reason: o.reason });
  saveSidecar(file, sidecar); console.log(`deviation ${slug}: ${o.kind} (${sidecar.contentDeviations.length} recorded)`); return 0;
}
export function decisionCmd(o, slug) {
  if (!slug || !o.kind) throw new UsageError('decision <slug> --kind <k> [--json <object>]');
  const { file, sidecar } = sidecarPath(o, slug);
  let extra = {}; if (o.json) { try { extra = JSON.parse(o.json); } catch { throw new UsageError('--json must be a JSON object'); } }
  sidecar.migrationDecisions = pushUnique((sidecar.migrationDecisions || []), { kind: o.kind, ...extra });
  saveSidecar(file, sidecar); console.log(`decision ${slug}: ${o.kind} (${sidecar.migrationDecisions.length} recorded)`); return 0;
}
export function variantCmd(o, slug, classes) {
  if (!slug || !classes.length) throw new UsageError('variant <slug> <class…>');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.variants = pushUnique(sidecar.variants || [], classes.join(' '));
  saveSidecar(file, sidecar); console.log(`variant ${slug}: ${classes.join(' ')} (${sidecar.variants.length} recorded)`); return 0;
}
export function modulesCmd(o, slug, ids) {
  if (!slug || (!ids.length && !o.clear)) throw new UsageError('modules <slug> <id…> | --clear');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.modules = o.clear ? [] : [...new Set([...(sidecar.modules || []), ...ids])];
  saveSidecar(file, sidecar); console.log(`modules ${slug}: [${sidecar.modules.join(', ')}]`); return 0;
}
// C14: <slug> passed the local harness launches → the archetype's passedOn (encode/shape.mjs, loaded only here)
const projectOf = (out) => { const m = posix.normalize(toPosix(out)).replace(/\/+$/, ''); return posix.basename(m) === 'migrated' && posix.basename(posix.dirname(m)) === 'stardust' ? posix.dirname(posix.dirname(m)) || '.' : '.'; };
export async function harnessCmd(o, slug) {
  if (!slug) throw new UsageError('harness <slug> [--content <dir>]');
  const { file, sidecar } = sidecarPath(o, slug);
  const refuse = (what, fix) => { throw new RunRefusal(`harness ${slug}: refused — ${what} — ${fix}`); };
  const archetype = typeof sidecar.encode?.map?.template === 'string' ? sidecar.encode.map.template : null;
  if (!archetype) refuse(`${toPosix(file)} records no encode`, 'passedOn belongs to an encoded template: encode the page first (encode.mjs --template <archetype>)');
  const shape = await import('./encode/shape.mjs');
  const root = projectOf(o.out);
  const enc = shape.encodedShape({ root, sidecarPath: toPosix(relative(root, file)), archetype });
  if (!enc.ok) refuse(enc.why, 'record the launches of the current clean encode only');
  if (slug === archetype) {
    // the map round-trips: the gated document the launches ran on and the encoded document compare equal at core
    const contentFile = join(o.content ?? join(root, 'content'), sidecar.encode.output.path.slice('stardust/encoded/'.length));
    if (!isFile(contentFile)) refuse(`no gated document ${toPosix(contentFile)}`, 'the archetype\'s launches run on its gated document: deliver it first');
    const gatedHtml = readFileSync(contentFile, 'utf8'); const encodedHtml = readFileSync(join(root, sidecar.encode.output.path), 'utf8');
    const { compareDocs } = await import('./encode/compare.mjs');
    const cmp = compareDocs(gatedHtml, encodedHtml, { level: 'core' });
    if (!cmp.equal) refuse(`${toPosix(contentFile)} and ${sidecar.encode.output.path} differ at core (${cmp.diffs.length} difference(s), first: ${cmp.diffs[0].kind} at ${cmp.diffs[0].where})`, `the map does not round-trip: encode.mjs --roundtrip --template ${archetype} --level core`);
    const gated = shape.shapeOf(gatedHtml);
    if (JSON.stringify(gated) !== JSON.stringify(enc.shape)) {
      const gap = shape.covers(enc.shape, [gated]).gaps[0] || shape.covers(gated, [enc.shape]).gaps[0] || 'the blocks differ in order or number';
      refuse(`${toPosix(contentFile)} and the archetype's encode differ in block shape (encode vs gated: ${gap}) — the recorded shape would not be the one the launches ran on`, `align the map with the gated document (encode.mjs --roundtrip --template ${archetype} --level strict)`);
    }
  }
  let key;
  try { ({ key } = await shape.harnessKey(root, archetype)); } catch (e) { refuse(`no harness key: ${e.message}`, 'fix it, then re-run'); }
  const arch = slug === archetype ? { file, sidecar } : sidecarPath(o, archetype);
  const old = arch.sidecar.passedOn ?? null;
  if (slug !== archetype && !(shape.isPassedOn(old) && old.key === key && old.shapes.some((e) => e.slug === archetype))) {
    refuse(`${archetype} has no harness pass under the current key (${key.slice(0, 19)}…)`, `record the archetype's pass first: run its launches, then migrate.mjs harness ${archetype}`);
  }
  const next = shape.passedOnWith(old, { key, slug, shape: enc.shape });
  const unchanged = JSON.stringify(old) === JSON.stringify(next);
  if (!unchanged) { arch.sidecar.passedOn = next; saveSidecar(arch.file, arch.sidecar); }
  const moved = shape.isPassedOn(old) && old.key !== key;
  console.log(`harness ${slug}: ${unchanged ? 'unchanged' : 'recorded'} — ${archetype} passedOn under ${key.slice(0, 19)}…: ${next.shapes.map((e) => e.slug).join(', ')}${moved ? ' (the key moved: the earlier record is replaced)' : ''}`);
  return 0;
}
export function summaryCmd(o) {
  const state = loadState(o.state); const rows = [];
  for (const p of state.pages) {
    const { outputPath, passthrough } = outputPathFor(p.url || p.path || `/${p.slug}/`);
    const file = passthrough ? null : join(o.out, sidecarFor(outputPath)); const s = file && isFile(file) ? readJson(file) : null;
    rows.push({ slug: p.slug, status: p.status, branch: s ? s.renderBranch : null, tier: s ? s.fidelityTier : null, gates: s ? (s.gatesPassed || []).length : null, variants: s ? (s.variants || []).length : null, deviations: s ? (s.contentDeviations || []).length : null, broken: s ? (s.brokenInternalLinks || []).length : null, outputPath: passthrough ? `${outputPath} (passthrough)` : outputPath, sidecar: !!s });
  }
  if (o.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  const d = (v) => (v === null || v === undefined ? '—' : String(v));
  const cols = ['slug', 'status', 'branch', 'tier', 'gates', 'variants', 'deviations', 'broken', 'outputPath'];
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => d(r[c]).length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join('  '));
  for (const r of rows) console.log(cols.map((c, i) => d(r[c]).padEnd(w[i])).join('  '));
  console.log(`${rows.filter((r) => r.sidecar).length} of ${rows.length} pages have a sidecar under ${toPosix(o.out)}/`);
  return 0;
}
export function pagemapCmd(o) {
  const state = loadState(o.state); const m = buildPageMap(state.pages, state.site?.originUrl || null);
  for (const e of m.entries) console.log(`${e.slug.padEnd(24)} ${e.sourceUrl.padEnd(36)} → ${e.outputPath}${e.passthrough ? '  (passthrough)' : ''}${m.collisions.has(e.folded) ? `  COLLISION${e.folded !== e.outputPath ? ` (folds to ${e.folded})` : ''}` : ''}`);
  console.log(`${m.entries.length} entries, ${m.collisions.size} collision(s)`);
  return m.collisions.size ? 2 : 0;
}

// ---- argv and entry point ----------------------------------------------------------------------
const BOOL = new Set(['all', 'force', 'inline-canon', 'json', 'clear', 'from-archetype']);
const REPEAT = new Set(['source', 'archetype']); // slug=value pairs on render; --source is free text elsewhere
export function parseArgs(argv) {
  const o = { ...DEFAULTS, slugs: [], sources: {}, archetypes: {}, branchB: new Set(), all: false, force: false, inlineCanon: false, fromArchetype: false, json: false, clear: false, evidence: null, content: null, kind: null, source: null, target: null, reason: null, stardustVersion: null, mediaMap: null, mediaLedger: null, acceptVariance: null, varianceDir: null, slotSource: null, encoder: null };
  const positional = []; const raw = { source: [], archetype: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('='); const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)); let val = eq > 0 ? a.slice(eq + 1) : undefined;
    // --json is a switch on summary and takes an object on decision
    if (name === 'json' && val === undefined && argv[i + 1]?.startsWith('{')) val = argv[++i];
    if (BOOL.has(name) && val === undefined) { o[{ 'inline-canon': 'inlineCanon', 'from-archetype': 'fromArchetype' }[name] || name] = true; continue; }
    // A value flag never swallows the next flag: `--evidence --force` is a forgotten value, not the text "--force".
    if (val === undefined) { val = argv[++i]; if (val === undefined) throw new UsageError(`--${name} needs a value`); if (val.startsWith('--')) throw new UsageError(`--${name} needs a value (got ${val}, which is a flag)`); }
    if (REPEAT.has(name)) { raw[name].push(val); continue; }
    if (name === 'branch-b') { for (const t of val.split(',')) if (t.trim()) o.branchB.add(t.trim()); continue; }
    const key = { 'proto-dir': 'protoDir', 'canon-css': 'canonCss', 'stardust-version': 'stardustVersion', 'media-map': 'mediaMap', 'media-ledger': 'mediaLedger', 'accept-variance': 'acceptVariance', 'variance-dir': 'varianceDir', slots: 'slotSource' }[name] || name;
    if (!(key in o)) throw new UsageError(`unknown flag --${name}`);
    o[key] = val;
  }
  if (positional[0] === 'render' || positional[0] === 'plan') {
    for (const name of REPEAT) for (const v of raw[name]) { const m = v.match(/^([^=]+)=(.+)$/); if (!m) throw new UsageError(`--${name} takes slug=value`); o[`${name}s`][m[1]] = m[2]; }
  } else if (raw.source.length) o.source = raw.source.join(' ');
  return { o, positional };
}
export function main(argv) {
  const { o, positional } = parseArgs(argv);
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case 'render': o.slugs = rest; return renderRun(o);
    case 'plan': o.slugs = rest; return planRun(o);
    case 'gate': return gateCmd(o, rest[0], rest[1]);
    case 'deviation': return deviationCmd(o, rest[0]);
    case 'decision': return decisionCmd(o, rest[0]);
    case 'variant': return variantCmd(o, rest[0], rest.slice(1));
    case 'modules': return modulesCmd(o, rest[0], rest.slice(1));
    case 'harness': return harnessCmd(o, rest[0]);
    case 'summary': return summaryCmd(o);
    case 'pagemap': return pagemapCmd(o);
    default: throw new UsageError(`unknown command: ${cmd || '(none)'} — see --help`);
  }
}
// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) {
  if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length < 3) { console.log(help()); process.exit(0); }
  const fail = (e) => {
    if (e instanceof UsageError) { console.error(`usage error: ${e.message}`); process.exit(1); }
    if (e instanceof Refusal || e instanceof RunRefusal) { console.error(e.message); process.exit(2); }
    throw e;
  };
  // every subcommand is synchronous except harness (it loads the encoder's modules)
  try { const code = main(process.argv.slice(2)); if (code instanceof Promise) code.then((c) => process.exit(c), fail); else process.exit(code); } catch (e) { fail(e); }
}
