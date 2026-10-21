#!/usr/bin/env node
/**
 * migrate/encode-attempt.mjs — records, per template, whether the shipped sibling encoder (encode.mjs) was tried on
 * it and what its round-trip said. A template whose archetype round-trips is `encoded`: its siblings are encoded,
 * not hand-built. Every other template is A′ (siblings rendered from the archetype by migrate.mjs) — and the record
 * says why: `no-roundtrip` (the encoder ran and the archetype does not round-trip), `not-attempted` (no encoder,
 * no map, or an owner decision) or `hand-authored` (the siblings are written by hand, with the reason). A recorded
 * hands-off run never invoked the encoder and hand-built every sibling;
 * this record makes the choice explicit, so migrate can refuse an A′ sibling whose template has none.
 *
 * Usage:
 *   node stardust/scripts/migrate/encode-attempt.mjs record --template <t>[,<t>…] [--root .] [--encoder <file>]
 *        [--not-attempted "<reason>" | --reason "<why>"] [--state <file>]
 *   node stardust/scripts/migrate/encode-attempt.mjs record --template <t> --hand-authored --reason "<why>"
 *        [--pages <slug,…>] [--root .] [--state <file>]
 *   node stardust/scripts/migrate/encode-attempt.mjs check --template <t>[,<t>…] [--root .]
 *   node stardust/scripts/migrate/encode-attempt.mjs summary [--root .] [--state <file>] [--json]
 *   (--template repeats or takes a comma list; a template name is letters, digits, `_`, `.`, `-` and not only dots;
 *   --root is the project directory, default the cwd; a value flag followed by nothing or by another --flag is a
 *   usage error)
 *
 * record — per template: the encoder is --encoder <file>, else encode.mjs beside this script (the same directory in
 *   the plugin tree and in the stardust/scripts/migrate/ copy). It runs
 *   `node <encoder> --roundtrip --template <t> --root <root>`, then `node <encoder> --lint --template <t> --root <root>`
 *   (no shell, 120 s timeout each) and keeps each one's exit code and LAST stdout line. Verdict:
 *     roundtrip exit 0                    → encoded
 *     roundtrip exit 2                    → no-roundtrip, reason = its line
 *     exit 1 / other / timeout / spawn error → no-roundtrip, the reason names it (exit 1 adds the last stderr line)
 *     encoder absent                      → not-attempted, `encode.mjs not found beside this script` (nothing run;
 *                                           the default lookup only — a --encoder <file> that does not exist is a
 *                                           usage error, exit 2, nothing run or written, never not-attempted)
 *     no stardust/import/<t>/vocabulary.json → not-attempted, `no map at … — the encoder needs the template's map`
 *                                           (nothing run)
 *     --not-attempted "<reason>"          → not-attempted with that reason — an owner decision, nothing run; the
 *                                           reason must be non-empty, must not name a generator script (a
 *                                           .mjs/.js/.py/.sh file or a stardust/.work/ path — a script is not a
 *                                           decision, the owner's decision is a sentence; exit 2), and on a template
 *                                           with ≥ 1 sibling must begin with a recorded refusal reason:
 *                                           `re-typed:` (the siblings were re-typed into other templates) or
 *                                           `no-repeatable-structure:` (one-off sections, no slot to map) — else
 *                                           exit 2 naming the map to author
 *     --hand-authored --reason "<why>"    → hand-authored: the siblings are written by hand (migrate SKILL.md § When
 *                                           the encoder cannot); nothing run, the reason required, pages = --pages
 *                                           <slug,…> (sorted) else the template's siblings, an earlier record's
 *                                           roundtrip and lint kept as the evidence; never with --encoder or
 *                                           --not-attempted; --pages needs --hand-authored
 *   Encoder first (migrate SKILL.md § Encoder first): on the CLI the two automatic not-attempted outcomes (encoder
 *   absent, no map) are REFUSED for a template with ≥ 1 sibling unless --reason "<tag>: <why>" names a recorded
 *   refusal reason (`re-typed:`, `no-repeatable-structure:`) the encoder cannot serve — or, below two siblings,
 *   migrate.mjs plan derived the template's slot map (source derived, below: the fork builds the one sibling). The
 *   map itself, stardust/import/<t>/vocabulary.json, is authored at C-archetype from the gated archetype's delivered
 *   document and its capture (migrate/reference/importer-recipe.md § Encoder contract; shape:
 *   migrate/reference/vocabulary.example.json) — no instrument writes it; `migrate.mjs plan` derives the SLOT map
 *   only and refuses a template with two or more siblings until its map exists (`maps due`). Refused: nothing
 *   written (an earlier automatic not-attempted record of the template is
 *   removed — it would open render's A′ path), exit 2, one stderr line `encode-attempt <t>: refused not-attempted —
 *   <n> sibling(s) (<slug, …>) and <cause>: <fix> — or a recorded refusal reason: --reason "re-typed|no-repeatable-structure:
 *   <why the encoder cannot serve this template>"` (the no-map <fix> is `author the map stardust/import/<t>/vocabulary.json
 *   from the gated archetype's delivered document and its capture (…), then record again`; plus `; no slot map derives
 *   either (<cause>) — <the one command>`, or, when one derives for two or more siblings, `; a derived slot map (<n>
 *   slot(s)) serves one sibling's fork, not <n> siblings — the map is due`). With a recorded --reason the record's reason
 *   is `<why> (<cause>)`; --reason is used only on these two outcomes and never with --not-attempted. A reason that
 *   names a generator script is refused (exit 2) whatever the sibling count. Siblings (siblingsOf): the --state pages (default
 *   <root>/stardust/state.json; none when it is absent) whose representative is <t>, whose migrate sidecar names <t>
 *   as its template (read under state.migrate.outputDir, else stardust/migrated — delivered siblings count), and —
 *   when <t> is the single approved / migrated page of its type, those aside — every other page of that type that is
 *   not approved / migrated and names no representative.
 *   One stdout line per template: `encode-attempt <t>: <verdict> — <reason or roundtrip line>` (hand-authored adds
 *   ` (<n> page(s): <slug, …>)`; a record whose source is derived or forked adds ` · source <source>: <sourceReason>`). A record is
 *   rewritten on every `record`; the verdict is information, not a failure (exit 0 whatever it is; 2 when a template
 *   was refused).
 * check — every named template needs a readable record (valid JSON, its own template name, a verdict above):
 *   exit 0 `encode-attempt: <n> template(s) recorded`; else exit 2 and, on stderr, one line per missing or invalid
 *   template: `encode-attempt <t>: no attempt record — run: node stardust/scripts/migrate/encode-attempt.mjs record
 *   --template <t>`.
 * summary — first one line per template (every record's, and every representative the state names; sorted) — the
 *   line the roster report quotes for the lead: `encode-attempt <t>: <n> siblings · <m> encoded · <k> A′ · <reason>`
 *   (<k> A′ = every sibling not encoded; <reason> = the record's reason, else its verdict, else `no record`; an A′
 *   render with no record is flagged `; <u> A′ without a record: <slug, …>`); each sibling (siblingsOf) counted once,
 *   first match: encoded (its migrate sidecar has `encode` and audit.encode.status clean), slot-rendered (an A′ fork:
 *   renderBranch A′ with a slotSource, or listed in the record's `forked`), hand-authored (named by the template's
 *   hand-authored record, or an A′ render from its own file — listed as without a record), else not-attempted; the
 *   sidecars are read under state.migrate.outputDir, else stardust/migrated. Then, last, every record under the record
 *   directory: `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted, <h> hand-authored)`; an invalid
 *   record file is named on stderr and not counted. --json: { total, encoded, aPrime, noRoundtrip, notAttempted,
 *   handAuthored, templates: [{ template, verdict, reason, source[, pages] }] (pages on hand-authored only),
 *   perTemplate: [{ template, verdict, siblings, encoded, slotRendered, handAuthored, notAttempted, unrecorded[],
 *   aPrime, reason }] } sorted by
 *   template.
 *
 * Reads:  <root>/stardust/migrate/encode/<t>.json, <root>/stardust/import/<t>/vocabulary.json (existence only), the
 *         state file (record and summary: the siblings), the migrate sidecars (summary), and the encoder's stdout / stderr / exit code (the encoder's
 *         --roundtrip and --lint write nothing).
 * Writes: <root>/stardust/migrate/encode/<t>.json (record only; tmp + rename; fixed key order):
 *         { "_provenance": { writtenBy: "stardust:migrate/encode-attempt", writtenAt }, "template",
 *           "verdict": "encoded" | "no-roundtrip" | "not-attempted" | "hand-authored", "roundtrip": { exit, line } |
 *           null, "lint": { exit, line } | null, "reason": <string | null>, "pages": [<slug>…] (hand-authored) | null,
 *           "siblings": <count>, "encoded": <count of those siblings whose sidecar is encoded>, "at": <ISO>, "source":
 *           "derived" | "forked" | "not-attempted", "sourceReason": <string>, "derive": { prototype, markers: "marked"
 *           | "derived", slots: [<name>…], located, total, capture } | null, "forked": [<slug>…] | null }
 *         source — how the A′ siblings get their slots: derived = migrate.mjs plan derived the slot map from the
 *         archetype prototype (`derive`; located / total / capture null when every sibling's page JSON has slots);
 *         forked = migrate.mjs render --from-archetype <proto> --capture <page.json> forked ≥ 1 sibling (`forked`,
 *         sorted; a list on a prior record survives any re-record, source staying forked); not-attempted = no derivation, sourceReason says
 *         why (the template encodes · an owner decision · hand-authored · nothing derivable — <cause> · no derivation
 *         on record — this CLI never derives). Readers accept older records without these four keys.
 *         check and summary write nothing.
 * Library (imported by migrate.mjs): readAttempt(root, t) → the record or null · requireEncodeAttempt(root, t) →
 *   null or the check refusal line · recordAttempt(root, t, { encoder, notAttempted, reason, handAuthored, pages,
 *   state, siblings, timeoutMs, siblingMin, enforceReasonVocabulary, derive }) → the record it wrote (throws
 *   UsageError, writing nothing, when a named encoder does not exist; Refusal, the encoder-first/script/vocabulary
 *   line, when it refuses; siblings: slugs that replace the state's; siblingMin defaults to 2 and
 *   enforceReasonVocabulary to false — the CLI passes 1 and true; derive: plan's derivation { prototype, markers,
 *   slots, located, total, capture }, or { cause, fix } when nothing derives — a derivation satisfies the gate only
 *   below two siblings) · recordFork(root, t, slug, { prototype
 *   }) → the record with slug added to `forked` and source forked, the rest kept (atomic; Refusal when t has no
 *   record) · siblingsOf(state,
 *   t[, sidecars]) → sorted slugs · isAutoNotAttempted(record) → true when its reason is only an automatic cause ·
 *   attemptLine(record) → the record's stdout line · sidecarsBySlug(root, state) → slug → migrate sidecar · siblingTally(state, record, sidecars, t) → the summary's counts ·
 *   summaryLine(records) → the summary line (a null entry is counted as ` · <k> without a record`).
 * Exit: 0 ok · 1 I/O (a record could not be written) · 2 usage error (an --encoder or --state that does not exist
 *   included), an encoder-first refusal or a check refusal (message on stderr).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
// Only the main-module check below calls it: importing this module never prints or exits.
function help() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
}

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const WRITTEN_BY = 'stardust:migrate/encode-attempt';
const VERDICTS = ['encoded', 'no-roundtrip', 'not-attempted', 'hand-authored'];
const TIMEOUT_MS = 120000;
const RECORD_CMD = 'node stardust/scripts/migrate/encode-attempt.mjs record --template';

export class UsageError extends Error {}
// A record the encoder-first rule does not allow (no map, ≥ 2 siblings, no reason): nothing written, exit 2.
export class Refusal extends Error {}

const SIBLING_MIN = 2;
const ARCHETYPE_STATUS = new Set(['approved', 'migrated']);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
// A name that is only dots would turn stardust/import/<t>/ into a parent directory.
const validTemplate = (t) => typeof t === 'string' && /^[\w.-]+$/.test(t) && !/^\.+$/.test(t);
const recordDir = (root) => join(root, 'stardust', 'migrate', 'encode');
const mapRel = (t) => `stardust/import/${t}/vocabulary.json`;
const lastLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? null;

function assertTemplate(t) {
  if (!validTemplate(t)) throw new UsageError(`template ${JSON.stringify(t)} is not a template name (letters, digits, _ . - and not only dots)`);
}

/** The record for `template` under `root`, or null when there is none or it is not a valid attempt record. */
export function readAttempt(root, template) {
  if (!validTemplate(template)) return null;
  let rec;
  try { rec = JSON.parse(readFileSync(join(recordDir(root), `${template}.json`), 'utf8')); } catch { return null; }
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  if (rec.template !== template || !VERDICTS.includes(rec.verdict)) return null;
  return rec;
}

/** null when `template` has an attempt record, else the refusal line naming the command that records one. */
export function requireEncodeAttempt(root, template) {
  return readAttempt(root, template) ? null : `encode-attempt ${template}: no attempt record — run: ${RECORD_CMD} ${template}`;
}

const AUTO_CAUSES = [/^encode\.mjs not found beside this script$/, /^no map at stardust\/import\/[^/]+\/vocabulary\.json — the encoder needs the template's map$/];
/** true for a not-attempted record whose reason is only an automatic cause (no encoder, no map) — no reason was given. */
export const isAutoNotAttempted = (rec) => rec?.verdict === 'not-attempted' && AUTO_CAUSES.some((re) => re.test(String(rec.reason ?? '')));

// The recorded refusal reasons the skill defines: an owner's not-attempted decision on a template WITH siblings must
// begin with one of these tags (migrate SKILL.md § When the encoder cannot). A free-text "sub-archetype (re-typed …)"
// or a generator script is not a decision — the owner names a reason the encoder cannot serve the template.
export const REFUSAL_REASONS = {
  're-typed': 'the siblings were re-typed into other templates (sub-archetypes); none remain here to encode',
  'no-repeatable-structure': "the template's sections are one-offs with no repeatable slot a map could target (verified, not assumed)",
};
const REASON_TAGS = Object.keys(REFUSAL_REASONS);
/** true when `r` begins with one of the defined recorded-refusal-reason tags (case-insensitive). */
export const isRecordedRefusalReason = (r) => typeof r === 'string' && REASON_TAGS.some((t) => new RegExp(`^${t}\\b`, 'i').test(r.trim()));
// A reason that names a generator the agent wrote is not an owner decision: a script PATH (a .mjs/.js/.py/.sh token
// carrying a directory separator), a stardust/.work reference, or a bare script filename that actually exists under
// the project. A bare name in prose ("encode.mjs cannot express the nested grid; written by hand") is a legitimate
// sentence and passes.
const SCRIPT_PATH_RE = /(^|[\s"'(])[\w.-]*\/[\w./-]*\.(?:mjs|js|py|sh)(?=\b|["')\s]|$)/i;
const SCRIPT_NAME_RE = /(?:^|[\s"'(/])([\w.-]+\.(?:mjs|js|py|sh))(?=\b|["')\s]|$)/ig;
const WORK_RE = /stardust\/\.work(\/|\b)/i;
const fileExistsUnder = (root, name) => {
  const SKIP = new Set(['node_modules', '.git']); const stack = [resolve(root)]; let budget = 50000;
  while (stack.length && budget-- > 0) {
    const dir = stack.pop(); let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP.has(e.name)) stack.push(join(dir, e.name)); }
      else if (e.name === name) return true;
    }
  }
  return false;
};
export const namesScript = (r, root = '.') => {
  if (typeof r !== 'string') return false;
  if (WORK_RE.test(r) || SCRIPT_PATH_RE.test(r)) return true;
  for (const m of r.matchAll(SCRIPT_NAME_RE)) if (fileExistsUnder(root, m[1])) return true;
  return false;
};

/**
 * The state pages that clone `template` (sorted slugs): a page whose representative is the template, a page whose
 * migrate sidecar (`sidecars`: slug → sidecar, sidecarsBySlug) names the template — so delivered (migrated) siblings
 * still count — and, when the template is the single approved / migrated page of its type (those siblings aside),
 * every other page of that type that is not approved / migrated and names no representative (migrate.mjs render's
 * branch fallback).
 */
export function siblingsOf(state, template, sidecars = null) {
  const pages = Array.isArray(state?.pages) ? state.pages.filter((p) => p && typeof p.slug === 'string') : [];
  const self = pages.find((p) => p.slug === template);
  const named = (p) => typeof p.representative === 'string' && p.representative && p.representative !== p.slug;
  const rendered = (p) => sidecars?.get(p.slug)?.template === template;
  const sole = typeof self?.type === 'string' && self.type && pages.filter((p) => p.type === self.type && ARCHETYPE_STATUS.has(p.status) && !rendered(p)).every((p) => p.slug === template);
  const out = pages.filter((p) => p.slug !== template && (named(p) ? p.representative === template : rendered(p) || (sole && p.type === self.type && !ARCHETYPE_STATUS.has(p.status))));
  return out.map((p) => p.slug).sort();
}

function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function runEncoder(encoder, mode, template, root, timeoutMs) {
  const r = spawnSync(process.execPath, [encoder, mode, '--template', template, '--root', root], { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false });
  const result = { exit: typeof r.status === 'number' ? r.status : null, line: lastLine(r.stdout) };
  const name = mode.slice(2);
  let failure = null;
  if (r.error?.code === 'ETIMEDOUT') failure = `${name} timed out after ${timeoutMs / 1000} s`;
  else if (r.error) failure = `${name} could not run: ${r.error.code || r.error.message}`;
  else if (result.exit === null) failure = `${name} killed by ${r.signal}`;
  else if (result.exit !== 0 && result.exit !== 2) failure = `${name} exit ${result.exit}: ${lastLine(r.stderr) || result.line || 'no output'}`;
  return { result, failure };
}

function writeRecord(root, rec) {
  const dir = recordDir(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${rec.template}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  try { writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`); renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

/**
 * Records one template's encode attempt under `root` and returns the record. opts: encoder (default encode.mjs beside
 * this script), notAttempted (an owner's reason: nothing is run), reason (why a not-attempted outcome is right for a
 * template with ≥ 2 siblings), state (the state file, default <root>/stardust/state.json), siblings (slugs; overrides
 * the state's), keepDecision (an automatic not-attempted outcome returns an existing decision record — hand-authored or
 * a reasoned not-attempted — unwritten), timeoutMs (per encoder run, default 120 s). Throws Refusal, writing nothing,
 * for a not-attempted outcome on a template with ≥ 2 siblings and no reason.
 */
export function recordAttempt(root, template, opts = {}) {
  assertTemplate(template);
  const { encoder = null, notAttempted = null, reason: given = null, handAuthored = false, pages: named = null, state = null, siblings = null, keepDecision = false, timeoutMs = TIMEOUT_MS, siblingMin = SIBLING_MIN, enforceReasonVocabulary = false, derive = null } = opts;
  if (notAttempted !== null && notAttempted !== undefined && (typeof notAttempted !== 'string' || !notAttempted.trim())) throw new UsageError('--not-attempted needs a non-empty reason');
  if (given !== null && given !== undefined && (typeof given !== 'string' || !given.trim())) throw new UsageError('--reason needs a non-empty reason');
  if (typeof given === 'string' && typeof notAttempted === 'string') throw new UsageError('--not-attempted carries its own reason — drop --reason');
  if (handAuthored && typeof given !== 'string') throw new UsageError('--hand-authored needs --reason "<why the siblings are written by hand>"');
  if (handAuthored && (encoder || typeof notAttempted === 'string')) throw new UsageError('--hand-authored runs nothing — drop --encoder and --not-attempted');
  if (named !== null && !handAuthored) throw new UsageError('--pages names hand-authored siblings — pass --hand-authored');
  // A generator script is not a decision; the owner's decision is a sentence (a recorded run named extract.mjs,
  // build-proposed.py and gen-content.mjs under stardust/.work/ as if that were an owner decision).
  for (const r of [notAttempted, given]) if (namesScript(r, root)) throw new Refusal(`encode-attempt ${template}: a generator script is not a decision; the owner's decision is a sentence — "${String(r).trim()}" names a script or a stardust/.work path`);
  const rootAbs = resolve(root);
  if (!isDir(rootAbs)) throw new UsageError(`--root ${root} is not a directory`);
  if (state && !isFile(state)) throw new UsageError(`--state ${state} does not exist`);
  const prior = readAttempt(rootAbs, template); // its forked list survives any re-record
  const at = new Date().toISOString();
  let verdict; let roundtrip = null; let lint = null; let reason = null; let cause = null; let fix = null; let pages = null;
  const st = readState(state || join(rootAbs, 'stardust', 'state.json'));
  const sidecars = sidecarsBySlug(rootAbs, st);
  const sibs = Array.isArray(siblings) ? [...new Set(siblings)].sort() : siblingsOf(st, template, sidecars);
  const encodedCount = sibs.filter((slug) => { const m = sidecars.get(slug); return !!(m && typeof m.encode === 'object' && m.encode && m.audit?.encode?.status === 'clean'); }).length;
  // An owner's not-attempted decision on a template with siblings must name a recorded refusal reason (not free text).
  const requireRefusalReason = (flag, r) => {
    if (enforceReasonVocabulary && sibs.length >= 1 && !isRecordedRefusalReason(r)) {
      throw new Refusal(`encode-attempt ${template}: ${flag} "${String(r).trim()}" is not a recorded refusal reason for a template with ${sibs.length} sibling(s) — use ${REASON_TAGS.join(' | ')} (encode-attempt --help), or author the map ${mapRel(template)} (migrate/reference/importer-recipe.md § Encoder contract) and record again`);
    }
  };
  const encoderFile = encoder ? resolve(encoder) : join(HERE, 'encode.mjs');
  // A named encoder that is not there is a typo, never "not attempted": that record would open render's A′ path.
  if (encoder && !isFile(encoderFile)) throw new UsageError(`--encoder ${encoder} does not exist`);
  if (handAuthored) {
    // The siblings are written by hand: nothing runs; an earlier attempt's roundtrip and lint stay as the evidence.
    const prev = readAttempt(rootAbs, template);
    verdict = 'hand-authored'; reason = given.trim(); roundtrip = prev?.roundtrip ?? null; lint = prev?.lint ?? null;
    pages = Array.isArray(named) ? [...new Set(named)].sort() : sibs;
  } else if (typeof notAttempted === 'string') { requireRefusalReason('--not-attempted', notAttempted); verdict = 'not-attempted'; reason = notAttempted.trim(); }
  else if (!isFile(encoderFile)) { cause = 'encode.mjs not found beside this script'; fix = 'copy the migrate scripts (encode.mjs and encode/) beside encode-attempt.mjs, then record again'; }
  else if (!isFile(join(rootAbs, mapRel(template)))) { cause = `no map at ${mapRel(template)} — the encoder needs the template's map`; fix = `author the map ${mapRel(template)} from the gated archetype's delivered document and its capture (no instrument writes it: migrate/reference/importer-recipe.md § Encoder contract; shape: migrate/reference/vocabulary.example.json), then record again`; }
  else {
    const rt = runEncoder(encoderFile, '--roundtrip', template, rootAbs, timeoutMs);
    lint = runEncoder(encoderFile, '--lint', template, rootAbs, timeoutMs).result;
    roundtrip = rt.result;
    if (rt.failure) { verdict = 'no-roundtrip'; reason = rt.failure; }
    else if (roundtrip.exit === 0) verdict = 'encoded';
    else { verdict = 'no-roundtrip'; reason = roundtrip.line || 'roundtrip exit 2'; }
  }
  if (cause && keepDecision) {
    // migrate.mjs plan --force: a recorded decision (hand-authored, a reason) stands when nothing new can run.
    const prev = readAttempt(rootAbs, template);
    if (prev && (prev.verdict === 'hand-authored' || (prev.verdict === 'not-attempted' && !isAutoNotAttempted(prev)))) return prev;
  }
  if (cause) {
    // Encoder first: a template with siblings gets its map (or a recorded refusal reason) — not-attempted is not the default.
    // A slot map migrate.mjs plan derived satisfies the gate only below two siblings: it feeds one sibling's fork, it is
    // not the encoder's map (a recorded hands-off run let every ≥ 2-sibling template through on a derivation and never
    // authored a map).
    if (sibs.length >= siblingMin && typeof given !== 'string' && !(isDerivation(derive) && sibs.length < 2)) {
      // An automatic not-attempted written before this rule would still open render's A′ path: it goes with the refusal.
      if (isAutoNotAttempted(readAttempt(rootAbs, template))) rmSync(join(recordDir(rootAbs), `${template}.json`), { force: true });
      const why = typeof derive?.cause === 'string' ? `; no slot map derives either (${derive.cause})${derive.fix ? ` — ${derive.fix}` : ''}`
        : isDerivation(derive) ? `; a derived slot map (${derive.slots.length} slot(s)) serves one sibling's fork, not ${sibs.length} siblings — the map is due` : '';
      throw new Refusal(`encode-attempt ${template}: refused not-attempted — ${sibs.length} sibling(s) (${sibs.join(', ')}) and ${cause.split(' — ')[0]}: ${fix} — or a recorded refusal reason: --reason "${REASON_TAGS.join('|')}: <why the encoder cannot serve this template>"${why}`);
    }
    if (typeof given === 'string') requireRefusalReason('--reason', given);
    verdict = 'not-attempted'; reason = typeof given === 'string' ? `${given.trim()} (${cause})` : cause;
  }
  const forked = forkedOf(prior);
  const src = sourceOf(verdict, { owner: typeof notAttempted === 'string', given: typeof given === 'string', derive, forked });
  const rec = { _provenance: { writtenBy: WRITTEN_BY, writtenAt: new Date().toISOString() }, template, verdict, roundtrip, lint, reason, pages, siblings: sibs.length, encoded: encodedCount, at, ...src, forked };
  writeRecord(rootAbs, rec);
  return rec;
}

// ---- the fork's slot source on record: derived (plan) · forked (render --from-archetype … --capture …) · not-attempted ----
const isDerivation = (d) => !!d && typeof d === 'object' && Array.isArray(d.slots);
const forkedOf = (rec) => (Array.isArray(rec?.forked) && rec.forked.length ? [...new Set(rec.forked)].sort() : null);
const NO_DERIVATION = 'no derivation on record — migrate.mjs plan derives the slot map';
function sourceOf(verdict, { owner, given, derive, forked }) {
  let source = 'not-attempted'; let sourceReason = NO_DERIVATION; let d = null;
  if (verdict === 'encoded') sourceReason = 'the template encodes';
  else if (verdict === 'hand-authored') sourceReason = 'hand-authored';
  else if (owner) sourceReason = 'an owner decision';
  else if (isDerivation(derive)) {
    d = { prototype: derive.prototype ?? null, markers: derive.markers ?? null, slots: [...derive.slots].sort(), located: derive.located ?? null, total: derive.total ?? null, capture: derive.capture ?? null };
    source = 'derived';
    sourceReason = `the slot map derives from ${d.prototype} (${d.slots.length} ${d.markers} slot(s); ${d.capture ? `${d.located}/${d.total} located in ${d.capture}` : 'every sibling\'s page JSON has slots'})`;
  } else if (typeof derive?.cause === 'string') sourceReason = `nothing derivable — ${derive.cause}`;
  else if (given) sourceReason = 'an owner decision';
  return { source: forked ? 'forked' : source, sourceReason, derive: d };
}

/**
 * Adds `slug` to the template's `forked` list (sorted, once) and sets source forked — migrate.mjs render --from-archetype
 * <prototype> --capture <page.json> forked it; every other key is kept, the rewrite is atomic, a slug already listed
 * rewrites nothing. Returns the record; throws Refusal when the template has no attempt record.
 */
export function recordFork(root, template, slug, { prototype = null } = {}) {
  assertTemplate(template);
  const rootAbs = resolve(root); const rec = readAttempt(rootAbs, template);
  if (!rec) throw new Refusal(`encode-attempt ${template}: no attempt record to add the fork of ${slug}${prototype ? ` (${prototype})` : ''} to — run: node stardust/scripts/migrate/migrate.mjs plan ${slug}`);
  const forked = [...new Set([...(forkedOf(rec) || []), slug])].sort();
  if (rec.source === 'forked' && JSON.stringify(rec.forked) === JSON.stringify(forked)) return rec;
  const { source, sourceReason, derive, forked: _f, ...kept } = rec;
  const next = { ...kept, source: 'forked', sourceReason: sourceReason ?? NO_DERIVATION, derive: derive ?? null, forked };
  writeRecord(rootAbs, next);
  return next;
}

/** `encode-attempt <t>: <verdict> — <reason or roundtrip line>`, a hand-authored record's pages after it, then ` · source
 * <derived | forked>: <sourceReason>` when the fork has a slot map. */
export function attemptLine(rec) {
  const pages = Array.isArray(rec.pages) ? ` (${rec.pages.length} page(s)${rec.pages.length ? `: ${rec.pages.join(', ')}` : ''})` : '';
  const source = rec.source === 'derived' || rec.source === 'forked' ? ` · source ${rec.source}: ${rec.sourceReason}` : '';
  return `encode-attempt ${rec.template}: ${rec.verdict} — ${rec.reason ?? rec.roundtrip?.line ?? `roundtrip exit ${rec.roundtrip?.exit}`}${pages}${source}`;
}

/** `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted, <h> hand-authored)`; null entries add ` · <k> without a record`. */
export function summaryLine(records) {
  const c = countVerdicts(records);
  return `encode: ${c.encoded} encoded · ${c.aPrime} A′ (${c.noRoundtrip} no-roundtrip, ${c.notAttempted} not-attempted, ${c.handAuthored} hand-authored)${c.missing ? ` · ${c.missing} without a record` : ''}`;
}

function countVerdicts(records) {
  const c = { encoded: 0, noRoundtrip: 0, notAttempted: 0, handAuthored: 0, missing: 0 };
  for (const r of records || []) {
    if (r?.verdict === 'encoded') c.encoded++;
    else if (r?.verdict === 'no-roundtrip') c.noRoundtrip++;
    else if (r?.verdict === 'not-attempted') c.notAttempted++;
    else if (r?.verdict === 'hand-authored') c.handAuthored++;
    else c.missing++;
  }
  return { ...c, aPrime: c.noRoundtrip + c.notAttempted + c.handAuthored };
}

// The migrate sidecars under the render output (state.migrate.outputDir, else stardust/migrated): slug → sidecar.
export function sidecarsBySlug(root, state) {
  const out = typeof state?.migrate?.outputDir === 'string' && state.migrate.outputDir.trim() ? state.migrate.outputDir : 'stardust/migrated';
  const bySlug = new Map();
  const walk = (dir) => {
    let names; try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const f = join(dir, d.name);
      if (d.isDirectory()) { walk(f); continue; }
      if (d.name !== '_meta.json' && !d.name.endsWith('._meta.json')) continue;
      let m; try { m = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
      if (m && typeof m.slug === 'string' && !bySlug.has(m.slug)) bySlug.set(m.slug, m);
    }
  };
  walk(resolve(root, out));
  return bySlug;
}

const SLOT_SOURCES = new Set(['mapping', 'page-json', 'derived']);
/**
 * One template's siblings by how they were built (the roster report's line), first match: encoded (a sidecar whose
 * `encode` is set and audit.encode.status clean), slot-rendered (an A′ fork: renderBranch A′ with a slotSource, or a
 * sibling the record lists in `forked` — render --from-archetype … --capture … wrote its source HTML),
 * hand-authored (named by the template's hand-authored record, or an A′ render from its own file — those without a
 * record are listed in `unrecorded`), else not-attempted.
 */
export function siblingTally(state, record, sidecars, template) {
  const t = { template, verdict: record?.verdict ?? null, siblings: 0, encoded: 0, slotRendered: 0, handAuthored: 0, notAttempted: 0, unrecorded: [] };
  const named = new Set(record?.verdict === 'hand-authored' && Array.isArray(record.pages) ? record.pages : []);
  const forked = new Set(forkedOf(record) || []);
  for (const slug of siblingsOf(state, template, sidecars)) {
    const m = sidecars.get(slug); t.siblings++;
    if (m?.encode && typeof m.encode === 'object' && m.audit?.encode?.status === 'clean') t.encoded++;
    else if ((m?.renderBranch === "A'" && SLOT_SOURCES.has(m.slotSource)) || forked.has(slug)) t.slotRendered++;
    else if (named.has(slug)) t.handAuthored++;
    else if (m?.renderBranch === "A'") { t.handAuthored++; t.unrecorded.push(slug); }
    else t.notAttempted++;
  }
  // A′ = every sibling not encoded; reason = the record's reason, else its verdict, else no record — the lead's roster line.
  t.aPrime = t.siblings - t.encoded;
  // A derived or forked source means the encoder engaged: quote its sourceReason, not the automatic 'no map' cause.
  t.reason = record ? (((record.source === 'derived' || record.source === 'forked') && record.sourceReason) ? record.sourceReason : (record.reason ?? record.verdict)) : 'no record';
  return t;
}
// The lead's roster line: <template>: <n> siblings · <m> encoded · <k> A′ · <reason> (an A′ render with no record is flagged).
const tallyLine = (t) => `encode-attempt ${t.template}: ${t.siblings} siblings · ${t.encoded} encoded · ${t.aPrime} A′ · ${t.reason}${t.unrecorded.length ? `; ${t.unrecorded.length} A′ without a record: ${t.unrecorded.join(', ')}` : ''}`;

// ---- CLI -----------------------------------------------------------------------------------------
const FLAGS = { record: ['template', 'root', 'encoder', 'not-attempted', 'reason', 'state', 'hand-authored', 'pages'], check: ['template', 'root'], summary: ['root', 'json', 'state'] };
const BOOL = new Set(['json', 'hand-authored']);

function parseArgs(argv) {
  const o = { cmd: null, templates: [], root: '.', encoder: null, notAttempted: null, reason: null, state: null, handAuthored: false, pages: null, json: false };
  const positional = []; const used = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    let val = eq > 0 ? a.slice(eq + 1) : undefined;
    if (!['template', 'root', 'encoder', 'not-attempted', 'reason', 'state', 'hand-authored', 'pages', 'json'].includes(name)) throw new UsageError(`unknown flag --${name}`);
    used.add(name);
    if (BOOL.has(name) && val === undefined) { o[name === 'hand-authored' ? 'handAuthored' : name] = true; continue; }
    // A value flag never swallows the next flag: `--not-attempted --root x` is a forgotten value.
    if (val === undefined) {
      val = argv[++i];
      if (val === undefined) throw new UsageError(`--${name} needs a value`);
      if (val.startsWith('--')) throw new UsageError(`--${name} needs a value (got ${val}, which is a flag)`);
    }
    if (name === 'template') o.templates.push(...val.split(',').map((t) => t.trim()).filter(Boolean));
    else if (name === 'pages') o.pages = [...(o.pages || []), ...val.split(',').map((t) => t.trim()).filter(Boolean)];
    else if (name === 'not-attempted') o.notAttempted = val;
    else o[name] = val;
  }
  o.cmd = positional[0] || null;
  if (positional.length > 1) throw new UsageError(`unexpected argument ${positional[1]}`);
  if (!FLAGS[o.cmd]) throw new UsageError(`unknown command: ${o.cmd || '(none)'} — record | check | summary (see --help)`);
  for (const f of used) if (!FLAGS[o.cmd].includes(f)) throw new UsageError(`${o.cmd} takes no --${f}`);
  o.templates = [...new Set(o.templates)];
  if (o.cmd !== 'summary') {
    if (!o.templates.length) throw new UsageError(`${o.cmd} needs --template <t>[,<t>…]`);
    for (const t of o.templates) assertTemplate(t);
  }
  if (o.notAttempted !== null && !o.notAttempted.trim()) throw new UsageError('--not-attempted needs a non-empty reason');
  if (o.notAttempted !== null && o.encoder) throw new UsageError('--not-attempted runs nothing — drop --encoder');
  if (o.reason !== null && !o.reason.trim()) throw new UsageError('--reason needs a non-empty reason');
  if (o.reason !== null && o.notAttempted !== null) throw new UsageError('--not-attempted carries its own reason — drop --reason');
  if (o.state !== null && !isFile(o.state)) throw new UsageError(`--state ${o.state} does not exist`);
  if (o.handAuthored && o.reason === null) throw new UsageError('--hand-authored needs --reason "<why the siblings are written by hand>"');
  if (o.handAuthored && (o.encoder || o.notAttempted !== null)) throw new UsageError('--hand-authored runs nothing — drop --encoder and --not-attempted');
  if (o.pages !== null && !o.handAuthored) throw new UsageError('--pages names hand-authored siblings — pass --hand-authored');
  if (!isDir(o.root)) throw new UsageError(`--root ${o.root} is not a directory`);
  if (o.encoder && !isFile(o.encoder)) throw new UsageError(`--encoder ${o.encoder} does not exist`);
  return o;
}

function recordCmd(o) {
  let code = 0;
  for (const t of o.templates) {
    let rec;
    // The CLI (the agent-facing path) enforces the stricter rules: a template with ≥ 1 sibling and no map gets the
    // "draft the map" remedy, and an owner's not-attempted names a recorded refusal reason. migrate.mjs's library
    // calls keep their own defaults.
    try { rec = recordAttempt(o.root, t, { encoder: o.encoder, notAttempted: o.notAttempted, reason: o.reason, state: o.state, handAuthored: o.handAuthored, pages: o.pages, siblingMin: 1, enforceReasonVocabulary: true }); } catch (e) {
      if (e instanceof UsageError) throw e;
      if (e instanceof Refusal) { console.error(e.message); code = 2; continue; }
      console.error(`encode-attempt ${t}: could not write ${join('stardust/migrate/encode', `${t}.json`)} — ${e.code || e.message}`);
      code = code || 1; continue;
    }
    console.log(attemptLine(rec));
  }
  return code;
}

function checkCmd(o) {
  const refusals = o.templates.map((t) => requireEncodeAttempt(o.root, t)).filter(Boolean);
  if (refusals.length) { for (const line of refusals) console.error(line); return 2; }
  console.log(`encode-attempt: ${o.templates.length} template(s) recorded`);
  return 0;
}

function summaryCmd(o) {
  const dir = recordDir(o.root);
  const files = isDir(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const records = [];
  for (const f of files) {
    const rec = readAttempt(o.root, f.slice(0, -'.json'.length));
    if (rec) records.push(rec); else console.error(`encode-attempt: stardust/migrate/encode/${f} is not a valid attempt record — not counted`);
  }
  records.sort((a, b) => (a.template < b.template ? -1 : a.template > b.template ? 1 : 0));
  const state = readState(o.state || join(o.root, 'stardust', 'state.json'));
  const sidecars = sidecarsBySlug(o.root, state);
  const named = (Array.isArray(state?.pages) ? state.pages : []).map((p) => p?.representative).filter((r) => typeof r === 'string' && validTemplate(r));
  const templates = [...new Set([...records.map((r) => r.template), ...named])].sort();
  const byTemplate = new Map(records.map((r) => [r.template, r]));
  const tallies = templates.map((t) => siblingTally(state, byTemplate.get(t), sidecars, t));
  if (!o.json) { for (const t of tallies) console.log(tallyLine(t)); console.log(summaryLine(records)); return 0; }
  const c = countVerdicts(records);
  console.log(JSON.stringify({ total: records.length, encoded: c.encoded, aPrime: c.aPrime, noRoundtrip: c.noRoundtrip, notAttempted: c.notAttempted, handAuthored: c.handAuthored, templates: records.map((r) => ({ template: r.template, verdict: r.verdict, reason: r.reason ?? null, source: r.source ?? null, ...(r.verdict === 'hand-authored' ? { pages: Array.isArray(r.pages) ? r.pages : [] } : {}) })), perTemplate: tallies }, null, 2));
  return 0;
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.cmd === 'record') return recordCmd(o);
  if (o.cmd === 'check') return checkCmd(o);
  return summaryCmd(o);
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) {
  if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length < 3) { console.log(help()); process.exit(0); }
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof UsageError) { console.error(`usage error: ${e.message}`); process.exit(2); }
    console.error(`encode-attempt: ${e.code || ''} ${e.message}`.trim()); process.exit(1);
  }
}
