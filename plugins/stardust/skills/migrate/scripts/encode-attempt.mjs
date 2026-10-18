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
 *                                           reason must be non-empty
 *     --hand-authored --reason "<why>"    → hand-authored: the siblings are written by hand (migrate SKILL.md § When
 *                                           the encoder cannot); nothing run, the reason required, pages = --pages
 *                                           <slug,…> (sorted) else the template's siblings, an earlier record's
 *                                           roundtrip and lint kept as the evidence; never with --encoder or
 *                                           --not-attempted; --pages needs --hand-authored
 *   Encoder first (migrate SKILL.md § Encoder first): the two automatic not-attempted outcomes (encoder absent, no
 *   map) are REFUSED for a template with ≥ 2 siblings unless --reason "<why>" names why the encoder cannot serve it —
 *   its map is due in the C-archetype unit. Refused: nothing written (an earlier automatic not-attempted record of
 *   the template is removed — it would open render's A′ path), exit 2, one stderr line `encode-attempt <t>: refused
 *   not-attempted — <n> sibling(s) (<slug, …>) and <cause>: <fix> — or pass --reason "<why the encoder cannot serve
 *   this template>"`. With --reason the record's reason is `<why> (<cause>)`; --reason is used only on these two
 *   outcomes and never with --not-attempted. Siblings (siblingsOf): the --state pages (default
 *   <root>/stardust/state.json; none when it is absent) whose representative is <t>, and — when <t> is the single
 *   approved / migrated page of its type — every other page of that type that is not approved / migrated and names
 *   no representative.
 *   One stdout line per template: `encode-attempt <t>: <verdict> — <reason or roundtrip line>` (hand-authored adds
 *   ` (<n> page(s): <slug, …>)`). A record is
 *   rewritten on every `record`; the verdict is information, not a failure (exit 0 whatever it is; 2 when a template
 *   was refused).
 * check — every named template needs a readable record (valid JSON, its own template name, a verdict above):
 *   exit 0 `encode-attempt: <n> template(s) recorded`; else exit 2 and, on stderr, one line per missing or invalid
 *   template: `encode-attempt <t>: no attempt record — run: node stardust/scripts/migrate/encode-attempt.mjs record
 *   --template <t>`.
 * summary — first one line per template (every record's, and every representative the state names; sorted) — the
 *   line the roster report quotes: `encode-attempt <t>: <s> sibling(s) · <e> encoded · <r> slot-rendered · <h>
 *   hand-authored · <n> not-attempted (<verdict | no record>[; <k> hand-authored without a record: <slug, …>])`; each
 *   sibling (siblingsOf) counted once, first match: encoded (its migrate sidecar has `encode` and audit.encode.status
 *   clean), slot-rendered (an A′ fork: renderBranch A′ with a slotSource), hand-authored (named by the template's
 *   hand-authored record, or an A′ render from its own file — listed as without a record), else not-attempted; the
 *   sidecars are read under state.migrate.outputDir, else stardust/migrated. Then, last, every record under the record
 *   directory: `encode: <e> encoded · <a> A′ (<n> no-roundtrip, <m> not-attempted, <h> hand-authored)`; an invalid
 *   record file is named on stderr and not counted. --json: { total, encoded, aPrime, noRoundtrip, notAttempted,
 *   handAuthored, templates: [{ template, verdict, reason[, pages] }] (pages on hand-authored only), perTemplate:
 *   [{ template, verdict, siblings, encoded, slotRendered, handAuthored, notAttempted, unrecorded[] }] } sorted by
 *   template.
 *
 * Reads:  <root>/stardust/migrate/encode/<t>.json, <root>/stardust/import/<t>/vocabulary.json (existence only), the
 *         state file (record and summary: the siblings), the migrate sidecars (summary), and the encoder's stdout / stderr / exit code (the encoder's
 *         --roundtrip and --lint write nothing).
 * Writes: <root>/stardust/migrate/encode/<t>.json (record only; tmp + rename; fixed key order):
 *         { "_provenance": { writtenBy: "stardust:migrate/encode-attempt", writtenAt }, "template",
 *           "verdict": "encoded" | "no-roundtrip" | "not-attempted" | "hand-authored", "roundtrip": { exit, line } |
 *           null, "lint": { exit, line } | null, "reason": <string | null>, "pages": [<slug>…] (hand-authored) | null,
 *           "at": <ISO> }
 *         check and summary write nothing.
 * Library (imported by migrate.mjs): readAttempt(root, t) → the record or null · requireEncodeAttempt(root, t) →
 *   null or the check refusal line · recordAttempt(root, t, { encoder, notAttempted, reason, handAuthored, pages,
 *   state, siblings, timeoutMs }) → the record it wrote (throws UsageError, writing nothing, when a named encoder does not exist;
 *   Refusal, the encoder-first line, when it refuses; siblings: slugs that replace the state's) · siblingsOf(state,
 *   t) → sorted slugs · isAutoNotAttempted(record) → true when its reason is only an automatic cause ·
 *   attemptLine(record) → the record's stdout line · siblingTally(state, record, sidecars, t) → the summary's counts ·
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

/**
 * The state pages that clone `template` (sorted slugs): a page whose representative is the template, and — when the
 * template is the single approved / migrated page of its type — every other page of that type that is not approved /
 * migrated and names no representative (migrate.mjs render's branch fallback).
 */
export function siblingsOf(state, template) {
  const pages = Array.isArray(state?.pages) ? state.pages.filter((p) => p && typeof p.slug === 'string') : [];
  const self = pages.find((p) => p.slug === template);
  const named = (p) => typeof p.representative === 'string' && p.representative && p.representative !== p.slug;
  const sole = typeof self?.type === 'string' && self.type && pages.filter((p) => p.type === self.type && ARCHETYPE_STATUS.has(p.status)).every((p) => p.slug === template);
  const out = pages.filter((p) => p.slug !== template && (named(p) ? p.representative === template : sole && p.type === self.type && !ARCHETYPE_STATUS.has(p.status)));
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
 * the state's), timeoutMs (per encoder run, default 120 s). Throws Refusal, writing nothing, for a not-attempted outcome
 * on a template with ≥ 2 siblings and no reason.
 */
export function recordAttempt(root, template, opts = {}) {
  assertTemplate(template);
  const { encoder = null, notAttempted = null, reason: given = null, handAuthored = false, pages: named = null, state = null, siblings = null, timeoutMs = TIMEOUT_MS } = opts;
  if (notAttempted !== null && notAttempted !== undefined && (typeof notAttempted !== 'string' || !notAttempted.trim())) throw new UsageError('--not-attempted needs a non-empty reason');
  if (given !== null && given !== undefined && (typeof given !== 'string' || !given.trim())) throw new UsageError('--reason needs a non-empty reason');
  if (typeof given === 'string' && typeof notAttempted === 'string') throw new UsageError('--not-attempted carries its own reason — drop --reason');
  if (handAuthored && typeof given !== 'string') throw new UsageError('--hand-authored needs --reason "<why the siblings are written by hand>"');
  if (handAuthored && (encoder || typeof notAttempted === 'string')) throw new UsageError('--hand-authored runs nothing — drop --encoder and --not-attempted');
  if (named !== null && !handAuthored) throw new UsageError('--pages names hand-authored siblings — pass --hand-authored');
  const rootAbs = resolve(root);
  if (!isDir(rootAbs)) throw new UsageError(`--root ${root} is not a directory`);
  if (state && !isFile(state)) throw new UsageError(`--state ${state} does not exist`);
  const at = new Date().toISOString();
  let verdict; let roundtrip = null; let lint = null; let reason = null; let cause = null; let fix = null; let pages = null;
  const siblingList = () => (Array.isArray(siblings) ? [...new Set(siblings)].sort() : siblingsOf(readState(state || join(rootAbs, 'stardust', 'state.json')), template));
  const encoderFile = encoder ? resolve(encoder) : join(HERE, 'encode.mjs');
  // A named encoder that is not there is a typo, never "not attempted": that record would open render's A′ path.
  if (encoder && !isFile(encoderFile)) throw new UsageError(`--encoder ${encoder} does not exist`);
  if (handAuthored) {
    // The siblings are written by hand: nothing runs; an earlier attempt's roundtrip and lint stay as the evidence.
    const prev = readAttempt(rootAbs, template);
    verdict = 'hand-authored'; reason = given.trim(); roundtrip = prev?.roundtrip ?? null; lint = prev?.lint ?? null;
    pages = Array.isArray(named) ? [...new Set(named)].sort() : siblingList();
  } else if (typeof notAttempted === 'string') { verdict = 'not-attempted'; reason = notAttempted.trim(); }
  else if (!isFile(encoderFile)) { cause = 'encode.mjs not found beside this script'; fix = 'copy the migrate scripts (encode.mjs and encode/) beside encode-attempt.mjs, then record again'; }
  else if (!isFile(join(rootAbs, mapRel(template)))) { cause = `no map at ${mapRel(template)} — the encoder needs the template's map`; fix = 'draft the map in the C-archetype unit (migrate SKILL.md § Encoder first), then record again'; }
  else {
    const rt = runEncoder(encoderFile, '--roundtrip', template, rootAbs, timeoutMs);
    lint = runEncoder(encoderFile, '--lint', template, rootAbs, timeoutMs).result;
    roundtrip = rt.result;
    if (rt.failure) { verdict = 'no-roundtrip'; reason = rt.failure; }
    else if (roundtrip.exit === 0) verdict = 'encoded';
    else { verdict = 'no-roundtrip'; reason = roundtrip.line || 'roundtrip exit 2'; }
  }
  if (cause) {
    // Encoder first: a template with ≥ 2 siblings gets its map in the C-archetype unit — not-attempted only with a reason.
    const sibs = siblingList();
    if (sibs.length >= SIBLING_MIN && typeof given !== 'string') {
      // An automatic not-attempted written before this rule would still open render's A′ path: it goes with the refusal.
      if (isAutoNotAttempted(readAttempt(rootAbs, template))) rmSync(join(recordDir(rootAbs), `${template}.json`), { force: true });
      throw new Refusal(`encode-attempt ${template}: refused not-attempted — ${sibs.length} sibling(s) (${sibs.join(', ')}) and ${cause.split(' — ')[0]}: ${fix} — or pass --reason "<why the encoder cannot serve this template>"`);
    }
    verdict = 'not-attempted'; reason = typeof given === 'string' ? `${given.trim()} (${cause})` : cause;
  }
  const rec = { _provenance: { writtenBy: WRITTEN_BY, writtenAt: new Date().toISOString() }, template, verdict, roundtrip, lint, reason, pages, at };
  writeRecord(rootAbs, rec);
  return rec;
}

/** `encode-attempt <t>: <verdict> — <reason or roundtrip line>`, a hand-authored record's pages after it. */
export function attemptLine(rec) {
  const pages = Array.isArray(rec.pages) ? ` (${rec.pages.length} page(s)${rec.pages.length ? `: ${rec.pages.join(', ')}` : ''})` : '';
  return `encode-attempt ${rec.template}: ${rec.verdict} — ${rec.reason ?? rec.roundtrip?.line ?? `roundtrip exit ${rec.roundtrip?.exit}`}${pages}`;
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
function sidecarsBySlug(root, state) {
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

/**
 * One template's siblings by how they were built (the roster report's line), first match: encoded (a sidecar whose
 * `encode` is set and audit.encode.status clean), slot-rendered (an A′ fork: renderBranch A′ with a slotSource),
 * hand-authored (named by the template's hand-authored record, or an A′ render from its own file — those without a
 * record are listed in `unrecorded`), else not-attempted.
 */
export function siblingTally(state, record, sidecars, template) {
  const t = { template, verdict: record?.verdict ?? null, siblings: 0, encoded: 0, slotRendered: 0, handAuthored: 0, notAttempted: 0, unrecorded: [] };
  const named = new Set(record?.verdict === 'hand-authored' && Array.isArray(record.pages) ? record.pages : []);
  for (const slug of siblingsOf(state, template)) {
    const m = sidecars.get(slug); t.siblings++;
    if (m?.encode && typeof m.encode === 'object' && m.audit?.encode?.status === 'clean') t.encoded++;
    else if (m?.renderBranch === "A'" && (m.slotSource === 'mapping' || m.slotSource === 'page-json')) t.slotRendered++;
    else if (named.has(slug)) t.handAuthored++;
    else if (m?.renderBranch === "A'") { t.handAuthored++; t.unrecorded.push(slug); }
    else t.notAttempted++;
  }
  return t;
}
const tallyLine = (t) => `encode-attempt ${t.template}: ${t.siblings} sibling(s) · ${t.encoded} encoded · ${t.slotRendered} slot-rendered · ${t.handAuthored} hand-authored · ${t.notAttempted} not-attempted (${t.verdict ?? 'no record'}${t.unrecorded.length ? `; ${t.unrecorded.length} hand-authored without a record: ${t.unrecorded.join(', ')}` : ''})`;

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
    try { rec = recordAttempt(o.root, t, { encoder: o.encoder, notAttempted: o.notAttempted, reason: o.reason, state: o.state, handAuthored: o.handAuthored, pages: o.pages }); } catch (e) {
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
  console.log(JSON.stringify({ total: records.length, encoded: c.encoded, aPrime: c.aPrime, noRoundtrip: c.noRoundtrip, notAttempted: c.notAttempted, handAuthored: c.handAuthored, templates: records.map((r) => ({ template: r.template, verdict: r.verdict, reason: r.reason ?? null, ...(r.verdict === 'hand-authored' ? { pages: Array.isArray(r.pages) ? r.pages : [] } : {}) })), perTemplate: tallies }, null, 2));
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
