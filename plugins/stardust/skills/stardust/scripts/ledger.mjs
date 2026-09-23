#!/usr/bin/env node
// skills/stardust/scripts/ledger.mjs — deterministic writer and reader for `stardust/status.jsonl`,
// the append-only phase-transition ledger every stardust skill feeds (contract:
// skills/stardust/reference/run-status.md). Replaces the hand-built printf / node -e one-shots
// agents used to author at each phase boundary: one command, one conformant JSON line, and the
// line is echoed so the agent's transcript carries the record.
//
//   node ledger.mjs <skill> <phase> <start|end|blocked> [--detail "…"] [--artifact <path>]
//                   [--next "…"] [--owner "…"] [--dir <stardust dir>] [--strict]
//   node ledger.mjs tail [-n 5] [--dir <stardust dir>]
//   node ledger.mjs last [<skill>] [--dir <stardust dir>]
//
// `--next` (what the next phase or the human does now) and `--owner` (who does it) are optional
// and land in the line as `next` / `owner` when given — an `end` line without `--next` is still
// accepted. A value flag (`--detail`, `--artifact`, `--next`, `--owner`, `--dir`, `-n`) followed
// by nothing or by another flag is a usage error naming the flag, so a forgotten value never
// swallows the next flag as its text. The default ledger dir (`stardust/`) is created on first
// write; an explicit `--dir` that does not exist is a usage error (exit 2) — a mistyped directory
// must not grow a second, empty ledger.
//
// `skill` is normalised to the `stardust:<name>` form whether given with or without the prefix.
// `phase` is checked against the table below; a known phase is written in the table's own form (an
// alias or a differently-cased name is rewritten — supervising runners match these strings exactly);
// an unknown skill or phase warns on stderr and the line is still written — under --strict it exits
// 2 and writes nothing. `blocked` without a --detail is treated the same way (the contract wants the
// blocker reason in `detail`).
//
// The start guard: an `end` needs an open `start` — an earlier line for the same skill + phase with
// event `start` and no `end` for that pair after it. Without one the `end` warns (plain mode) or is
// refused under --strict (exit 2, nothing written, one stderr line naming the missing start). The
// `start` line is the FIRST command of a phase, before any script runs: a recorded hands-off run wrote
// a phase's `start` and `end` one second apart after 109 minutes of work, so a supervisor tailing the
// ledger saw an idle run the whole time.
// The journal check: on `end`, when `<dir>/journal.md` exists and has no `## ` heading that names the
// phase (case-insensitive; dashes, underscores and spaces are one separator), one warning on stderr —
// never an exit-code change, even under --strict (a recorded run's journal began at its second session;
// another's had one section for the whole run). An absent journal is not checked.
// Exit codes: 0 ok · 2 usage or strict violation.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = 'stardust';
export const FILE_NAME = 'status.jsonl';
export const JOURNAL_NAME = 'journal.md'; // beside the ledger; checked on `end`
export const EVENTS = ['start', 'end', 'blocked'];
export const DEFAULT_TAIL = 5;
const DETAIL_HEAD = 72;

// Phase vocabulary per skill — derived from each skill's SKILL.md headings (read 2026-09), because
// run-status.md says `phase` is "the skill's own phase name, as its SKILL.md names it". Keys are
// the ledger form; the array holds accepted aliases. Rules used to derive the ledger form:
//   * numbered "Phase N — Title" headings → the title's descriptive word(s), lower-case kebab
//     (run-status.md's own example writes migrate's "Per-page render" as `render`);
//   * lettered / numbered step headings (rollout, deploy) → `<Letter or N>-<lower-case first word
//     of the heading>`, the form run-status.md's example shows for rollout (`C-deliver`);
//   * a mode or section that is a phase in practice (prep mode, the master's setup) → its heading
//     word.
// When a SKILL.md renames or adds a phase, update the matching entry here — the source heading is
// noted beside every ledger form.
export const PHASES = {
  // skills/stardust/SKILL.md — the master has no numbered phases; these are the H2 sections that do work.
  stardust: {
    setup: [], // ## Setup (run before anything else)
    routing: ['state-report'], // ## Routing (no-arg invocation renders the state report)
    intent: ['intent-reasoning'], // ## The "open and reasoned" principle → reference/intent-reasoning.md
    'hands-off': [], // ## Hands-off mode (activation stamps state.json.handsOff)
    validation: [], // ## Validation rule (the validate-and-fix loop)
  },
  // skills/extract/SKILL.md
  extract: {
    discovery: [], // ### Phase 1 — Discovery
    'per-page-extraction': ['extraction'], // ### Phase 2 — Per-page extraction
    'vision-verification': ['vision'], // ### Phase 2.5 — Vision verification
    'brand-surface-extraction': ['brand-surface'], // ### Phase 3 — Brand-surface extraction
    seed: [], // ### Phase 4 — Seed stardust/current/PRODUCT.md and DESIGN.md
    'brand-review': [], // ### Phase 5 — Render stardust/current/brand-review.html
    'state-and-report': ['report'], // ### Phase 6 — Update state and report
    prep: [], // ## Prep mode (--prep)
  },
  // skills/prototype/SKILL.md (the doc has no Phase 3; Phase 5.5 is retired and not listed)
  prototype: {
    plan: ['brief'], // ### Phase 1 — Plan the prototype (page-shape brief)
    render: [], // ### Phase 2 — Render the proposed page
    motion: [], // ### Phase 2.4 — Motion application (when --cinematic)
    critique: [], // ### Phase 2.5 — Critique
    audit: [], // ### Phase 2.6 — Audit (detector specifics)
    adapt: [], // ### Phase 2.7 — Adapt (mandatory pre-approval)
    'motion-validation': [], // ### Phase 2.8 — Motion validation
    iterate: [], // ### Phase 4 — Open and iterate
    approval: ['approve'], // ### Phase 5 — Approval (+ fold-back)
    prep: [], // ## Prep mode (--prep)
  },
  // skills/migrate/SKILL.md
  migrate: {
    plan: [], // ### Phase 1 — Plan
    render: ['per-page-render'], // ### Phase 2 — Per-page render (run-status.md example)
    assets: ['bundle'], // ### Phase 3 — Sitewide assets and bundle finalisation
    'state-and-report': ['report'], // ### Phase 4 — State and report
  },
  // skills/replica/SKILL.md (headings are upper-case; the ledger form is lower-case kebab)
  replica: {
    extract: [], // ### Phase 1 — EXTRACT
    'preserve-direction': [], // ### Phase 2 — PRESERVE DIRECTION
    recreate: [], // ### Phase 3 — RECREATE
    'source-fidelity-gate': ['gate'], // ### Phase 4 — SOURCE-FIDELITY GATE
    handoff: [], // ### Phase 5 — HANDOFF
  },
  // skills/dynamics/SKILL.md
  dynamics: {
    detect: [], // ## Phase 1 — Detect
    classify: [], // ## Phase 2 — Classify
    triage: [], // ## Phase 3 — Triage (the gate output)
    implement: [], // ## Phase 4 — Implement (per plan phase)
    verify: [], // ## Phase 5 — Verify: dynamic parity
  },
  // skills/rollout/SKILL.md — `<Letter>-<lower-case first word of the heading>`
  rollout: {
    'A-inventory': [], // ### Phase A — Inventory
    'B-block': [], // ### Phase B — Block dedup plan
    'B2-dynamic': [], // ### Phase B2 — Dynamic surface
    'C-deliver': [], // ### Phase C — Deliver the site
    'D-site': [], // ### Phase D — Site assembly
    'D2-dynamic': [], // ### Phase D2 — Dynamic features
    'D3-multilingual': [], // ### Phase D3 — Multilingual
    'E-full-site': [], // ### Phase E — Full-site verify
    'E2-link-audit': [], // ### Phase E2 — Link-audit completeness
    'F-optimize': [], // ### Phase F — Optimize
    'G-aem': [], // ### Phase G — … autofix (heading's first word is the target platform's name)
    'H-report': [], // ### Phase H — Report
    'I-dashboard': [], // ### Phase I — Dashboard
  },
  // skills/deploy/SKILL.md — numbered steps; same rule as rollout: `<N>-<lower-case first word>`
  deploy: {
    'runtime-probe': ['probe'], // ## Runtime-detection probe (run before Step 1)
    '1-audit': [], // ### 1. Audit (light)
    '2-decide': ['2-names'], // ### 2. Decide names + reuse
    '2b-section': ['2b-schema'], // ### 2b. Section schema + decode tier
    '3-foundation': [], // ### 3. Foundation
    '4-self-host': ['4-fonts'], // ### 4. Self-host fonts and minimize CLS
    '5-lean': ['5-buttons'], // ### 5. Lean on … button conventions
    '6-chrome': [], // ### 6. Chrome
    '7-blocks': [], // ### 7. Blocks (parallel agents)
    '8-block': ['8-scaffold'], // ### 8. Block JS scaffold
    '9-content': [], // ### 9. Content page scaffold
    'local-qa': [], // ## Local QA before deploy
    '10-reconcile': [], // ## Step 10 — Reconcile on the deployed URL
  },
};

const SELF = fileURLToPath(import.meta.url);
// The phase table, one line per skill, aliases in parentheses — printed by --help so the vocabulary
// is one command away (a recorded session grepped this file's source for it instead).
export const phaseTableText = () => Object.entries(PHASES)
  .map(([skill, table]) => `  ${skill}: ${Object.entries(table).map(([canon, aliases]) => (aliases.length ? `${canon} (${aliases.join(', ')})` : canon)).join(', ')}`)
  .join('\n');
const HELP = `Usage:
  node ledger.mjs <skill> <phase> <start|end|blocked> [--detail "…"] [--artifact <path>]
                  [--next "…"] [--owner "…"] [--dir <d>] [--strict]
  node ledger.mjs tail [-n ${DEFAULT_TAIL}] [--dir <d>]
  node ledger.mjs last [<skill>] [--dir <d>]
  (--dir defaults to ${DEFAULT_DIR}; the ledger is <dir>/${FILE_NAME}, created on first write;
   an explicit --dir must already exist)

Appends one run-status.md line { ts, skill, phase, event, detail?, artifact?, next?, owner? } and
prints it. --next / --owner are optional (an end line without --next is fine). A value flag followed
by nothing or by another flag is a usage error.
<skill> may be given as "extract" or "stardust:extract". A known <phase> is written in the table's
own form (aliases and case are normalised). Unknown skill/phase → warning on stderr, line still
written; with --strict → exit 2, nothing written. Exit codes: 0 ok, 2 usage/strict.
An end needs an open start (same skill + phase, no later end): missing → warning, or exit 2 under
--strict. Write the start line FIRST, before any script of the phase runs. On end, a <dir>/${JOURNAL_NAME}
without a "## " heading naming the phase gets a warning (never an exit-code change).
Known skills: ${Object.keys(PHASES).join(', ')}
Known phases per skill (ledger form; accepted aliases in parentheses):
${phaseTableText()}`;

export class UsageError extends Error { constructor(msg, code = 2) { super(msg); this.code = code; } }

// ---- pure helpers (exported for tests) ---------------------------------------------------------
export function normaliseSkill(raw) {
  const name = String(raw || '').trim().replace(/^stardust:/i, '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new UsageError(`skill "${raw}" is not a skill name (letters, digits, dashes; optional "stardust:" prefix)`);
  return `stardust:${name}`;
}
export const bareSkill = (skill) => skill.replace(/^stardust:/, '');
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim();

// Returns null when the (skill, phase) pair is known; otherwise the warning text.
export function checkPhase(skill, phase) {
  const table = PHASES[bareSkill(skill)];
  if (!table) return `unknown skill ${skill} (known: ${Object.keys(PHASES).join(', ')})`;
  const p = String(phase).toLowerCase();
  const ok = Object.entries(table).some(([canon, aliases]) => canon.toLowerCase() === p || aliases.some((a) => a.toLowerCase() === p));
  return ok ? null : `unknown phase "${phase}" for ${skill} (known: ${Object.keys(table).join(', ')})`;
}

// The table's own spelling for a known (skill, phase): an alias or a differently-cased form is rewritten
// to it, because supervising runners match these strings exactly (`I-dashboard`, never `i-dashboard`).
// An unknown pair, or an unknown skill, returns the phase unchanged.
export function canonicalPhase(skill, phase) {
  const table = PHASES[bareSkill(skill)];
  if (!table) return phase;
  const p = String(phase).toLowerCase();
  for (const [canon, aliases] of Object.entries(table)) {
    if (canon.toLowerCase() === p || aliases.some((a) => a.toLowerCase() === p)) return canon;
  }
  return phase;
}

export function buildLine({ skill, phase, event, detail, artifact, next, owner, ts = nowIso() }) {
  if (!EVENTS.includes(event)) throw new UsageError(`event must be one of ${EVENTS.join('|')}, got "${event}"`);
  const p = String(phase || '').trim();
  if (!p || /\s/.test(p)) throw new UsageError(`phase "${phase}" must be a single token (the skill's own phase name)`);
  const line = { ts, skill: normaliseSkill(skill), phase: p, event };
  if (detail != null && String(detail).trim()) line.detail = oneLine(detail);
  if (artifact != null && String(artifact).trim()) line.artifact = String(artifact).trim();
  if (next != null && String(next).trim()) line.next = oneLine(next);
  if (owner != null && String(owner).trim()) line.owner = oneLine(owner);
  return line;
}

// The start guard. Null when the ledger holds an open `start` for (skill, phase) — a start line for that
// pair with no end line for it afterwards (a `blocked` in between keeps it open); otherwise the warning
// text, naming the start command that is missing. Lines are compared in their canonical forms, so a
// hand-written alias or a differently-cased phase still pairs with its end.
export function checkOpenStart(lines, skill, phase) {
  const want = String(phase).toLowerCase();
  let open = false;
  for (const l of lines) {
    if (!l || String(l.skill || '').toLowerCase() !== skill) continue;
    if (String(canonicalPhase(skill, String(l.phase || ''))).toLowerCase() !== want) continue;
    if (l.event === 'start') open = true;
    else if (l.event === 'end') open = false;
  }
  return open ? null : `end for ${skill} ${phase} has no matching start (no earlier start line for this skill and phase without a later end) — the start line is the FIRST command of a phase, before any script runs: node ledger.mjs ${bareSkill(skill)} ${phase} start`;
}

export const journalPath = (dir) => join(dir, JOURNAL_NAME);
// Case folded, dashes / underscores / runs of spaces collapsed to one space: "Preserve direction",
// "preserve-direction" and "PRESERVE_DIRECTION" are one name.
const foldName = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();

// The journal check for `end`. Null when <dir>/journal.md is absent, or has a `## ` heading (exactly two
// hashes) whose text names the phase; otherwise the warning text. A warning only — the caller never turns
// it into an exit code.
export function checkJournalSection(dir, phase) {
  const file = journalPath(dir);
  if (!existsSync(file)) return null;
  const want = foldName(phase);
  const headings = readFileSync(file, 'utf8').split('\n').filter((l) => /^## /.test(l)).map((l) => foldName(l.slice(3)));
  if (headings.some((h) => h.includes(want))) return null;
  return `${file} has no "## " section naming ${phase} — a journal section is part of every phase end: "## ${phase} — <what happened> (<date>)"`;
}

export const ledgerPath = (dir) => join(dir, FILE_NAME);

export function readLines(dir) {
  const file = ledgerPath(dir);
  if (!existsSync(file)) return { lines: [], malformed: 0, file };
  let malformed = 0;
  const lines = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    try { lines.push(JSON.parse(raw)); } catch { malformed += 1; }
  }
  return { lines, malformed, file };
}

function endsWithNewline(file) {
  const size = statSync(file).size;
  if (size === 0) return true;
  const fd = openSync(file, 'r');
  try { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, size - 1); return b[0] === 0x0a; } finally { closeSync(fd); }
}

// Appends the line; creates <dir> and the file when missing. A hand-written last line that lacks
// its newline gets one first, so the appended record never fuses with it.
export function appendLine(dir, line) {
  const file = ledgerPath(dir);
  mkdirSync(dir, { recursive: true });
  const prefix = existsSync(file) && !endsWithNewline(file) ? '\n' : '';
  appendFileSync(file, `${prefix}${JSON.stringify(line)}\n`);
  return file;
}

export const formatTail = (l) => [l.ts, l.skill, l.phase, l.event, l.detail ? (l.detail.length > DETAIL_HEAD ? `${l.detail.slice(0, DETAIL_HEAD - 1)}…` : l.detail) : ''].join(' ').trimEnd();

// ---- argv --------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, dirGiven: false, strict: false, n: DEFAULT_TAIL, detail: null, artifact: null, next: null, owner: null };
  const pos = [];
  const isFlag = (v) => v.startsWith('--') || v === '-n' || v === '-h';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // A value flag never swallows the next flag: `--detail --strict` is a forgotten value, not the text "--strict".
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      if (isFlag(argv[i + 1])) throw new UsageError(`${a} needs a value (got ${argv[i + 1]}, which is a flag)`);
      i += 1; return argv[i];
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--dir') { opts.dir = need(); opts.dirGiven = true; }
    else if (a === '--detail') opts.detail = need();
    else if (a === '--artifact') opts.artifact = need();
    else if (a === '--next') opts.next = need();
    else if (a === '--owner') opts.owner = need();
    else if (a === '-n') { opts.n = Number(need()); if (!Number.isInteger(opts.n) || opts.n < 1) throw new UsageError('-n needs a positive integer'); }
    else if (a.startsWith('-') && a !== '-') throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  return { opts, pos };
}

// ---- main --------------------------------------------------------------------------------------
export function main(argv) {
  const { opts, pos } = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  if (pos.length === 0) throw new UsageError(HELP);
  if (opts.dirGiven && !(existsSync(opts.dir) && statSync(opts.dir).isDirectory())) throw new UsageError(`--dir ${opts.dir} is not an existing directory (a mistyped --dir must not start a second ledger; omit it for ${DEFAULT_DIR}/)`);
  const [cmd] = pos;

  if (cmd === 'tail') {
    const { lines, malformed, file } = readLines(opts.dir);
    if (malformed) console.error(`ledger: ${malformed} malformed line(s) skipped in ${file}`);
    if (!lines.length) { console.error(`ledger: no lines in ${file}`); return 0; }
    for (const l of lines.slice(-opts.n)) console.log(formatTail(l));
    return 0;
  }
  if (cmd === 'last') {
    const want = pos[1] ? normaliseSkill(pos[1]) : null;
    const { lines, malformed, file } = readLines(opts.dir);
    if (malformed) console.error(`ledger: ${malformed} malformed line(s) skipped in ${file}`);
    const hit = lines.filter((l) => !want || l.skill === want).at(-1);
    if (!hit) { console.error(`ledger: no lines${want ? ` for ${want}` : ''} in ${file}`); return 0; }
    console.log(JSON.stringify(hit));
    return 0;
  }

  if (pos.length !== 3) throw new UsageError(`expected <skill> <phase> <start|end|blocked>, got ${pos.length} argument(s)\n${HELP}`);
  const [skill, phase, event] = pos;
  const line = buildLine({ skill, phase, event, detail: opts.detail, artifact: opts.artifact, next: opts.next, owner: opts.owner });
  const canon = canonicalPhase(line.skill, line.phase);
  if (canon !== line.phase) {
    console.error(`ledger: phase "${line.phase}" written as "${canon}" (the table's form for ${line.skill})`);
    line.phase = canon;
  }
  const warnings = [
    checkPhase(line.skill, line.phase),
    event === 'blocked' && !line.detail ? 'blocked without --detail (the contract wants the blocker reason there)' : null,
    event === 'end' ? checkOpenStart(readLines(opts.dir).lines, line.skill, line.phase) : null,
  ].filter(Boolean);
  if (warnings.length && opts.strict) throw new UsageError(`strict: ${warnings.join('; ')} — nothing written`);
  for (const w of warnings) console.error(`ledger: warning: ${w}`);
  // The journal check is advisory: printed after the strict gate, so a refused end stays one stderr line.
  if (event === 'end') { const j = checkJournalSection(opts.dir, line.phase); if (j) console.error(`ledger: warning: ${j}`); }
  appendLine(opts.dir, line);
  console.log(JSON.stringify(line));
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof UsageError) { console.error(`ledger: ${e.message}`); process.exit(e.code); }
    console.error(`ledger: ${e.message}`); process.exit(1);
  }
}
