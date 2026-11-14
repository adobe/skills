#!/usr/bin/env node
/**
 * skills/replica/scripts/rounds.mjs
 *
 * The round ledger of the source-fidelity gate: counts gate rounds per (slug, width, stage) and
 * refuses the round after the cap (source-fidelity-gate.md § Iteration discipline — the one
 * definition; this header is its mechanical form). `gate.sh` calls `check` before any work and
 * `record` after a verdict, so nobody counts by hand and the round label stays free text.
 *
 * Definition
 *   round   one gate invocation that ended with a verdict (gate.sh exit 0 or 2) for a
 *           (slug, width, stage) triple; stage = prototype (a local / served prototype build URL)
 *           or published (a deployed origin). A round without a verdict — deadline 124, capture
 *           error 1 after the retry, bot challenge 3, identity 4 — is never recorded.
 *   kind    first    the triple's first verdict round (the map)
 *           confirm  a PASS directly after a PASS — not counted
 *           fix      every other round (a FAIL after a PASS is a fix round: it found something)
 *   cap     3 counted rounds per triple: the first round and two fix rounds. Confirmations are
 *           free. At the cap the next round is refused (exit 6) unless the last round passed (the
 *           round would be its confirmation) or a decision is recorded:
 *           accept-residual                  closes the triple — every later round exits 6
 *           re-prototype                     once per gate dir: both stages start again (spent rounds kept in `history`)
 *           extend                           ONE more counted round; only at the cap, and the
 *                                            reason must name an evidence file in the gate dir
 *                                            (the instrument defect that spent a round)
 *
 * Usage:
 *   node stardust/scripts/replica/rounds.mjs check  <gate-dir> --stage <s> --label <l>
 *   node stardust/scripts/replica/rounds.mjs record <gate-dir> --stage <s> --label <l> --verdict pass|fail
 *   node stardust/scripts/replica/rounds.mjs decide <gate-dir> --stage <s>
 *        --decision accept-residual|re-prototype|extend --reason "<text>"
 *   node stardust/scripts/replica/rounds.mjs status <gate-dir> [--json]
 *   node stardust/scripts/replica/rounds.mjs count  <gates-root> [--json]
 *
 *   <gate-dir>    stardust/replica/gates/<slug>-<width>   <gates-root>  stardust/replica/gates
 *   --stage       prototype | published
 *   check   exit 0 and one line when the round may run; exit 6 and one line on stderr naming the
 *           count and the two ways forward when it may not. Writes the ledger when there is none.
 *   record  appends { label, at, verdict, kind } for the stage; prints the new count.
 *   decide  records { decision, reason, at, counted }.
 *   status  one line per stage with rounds.   count  one row per (gate dir, stage), for reports.
 *
 * Ledger: <gate-dir>/rounds.json, written through a sibling temp file + rename:
 *   { "version": 1, "reconstructed": <ISO, when rebuilt from verdict files>,
 *     "stages": { "<stage>": { "rounds": [ { label, at, verdict, kind } ], "decisions": [ … ] } } }
 *
 * Reconstruction (a gate dir with no readable rounds.json): the verdict-<label>.json files are
 * the rounds, ordered by their `at` (file mtime when absent). Only `--full` rounds leave one, so
 * pixel-only rounds of that past are not counted. Stage = published when the label starts with
 * `pub` or the file carries a content-presence probe (gate.sh runs it in the published regime
 * only), else prototype. Verdict as gate.sh exits: none (not counted) on any exit 124, a pixel
 * exit other than 0 / 2 or a probe exit other than 0 / 2; fail on pixel 2, structural or
 * nothing-lost > 0, or exit 2 from chrome-parity, clip-probe, content-presence or unit-geometry;
 * else pass. Kinds come from order and verdict alone, never from the label: `map0` is `first`
 * only when it is the earliest, and `confirm`, `final*` or `post` count as fix rounds unless they
 * are a PASS directly after a PASS.
 *
 * STARDUST_ROUND_CAP=0 turns the refusal off (check always exits 0 and says so); rounds are still
 * recorded — for a project copy that is mid-run when this script arrives.
 *
 * Exit codes: 0 ok, 6 round refused (cap reached or triple closed), 1 ledger or filesystem
 * error, or a decision that does not apply, 125 usage. --help / -h prints this and touches no file.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const CAP = 3;
export const STAGES = ['prototype', 'published'];
/** gate-all's published measurements: recorded beside the gate.sh stages, counted, never capped by `check` — its verdict is not gate.sh's. */
export const ROSTER_STAGE = 'all-pages';
export const DECISIONS = ['accept-residual', 're-prototype', 'extend'];
const CLOSING = ['accept-residual'];
const LEDGER = 'rounds.json';

class UsageError extends Error {}
const usage = (msg) => { throw new UsageError(`rounds: ${msg} (see --help)`); };

/** The kind of the next round, given the stage's recorded rounds and this round's verdict. */
export function kindOf(rounds, verdict) {
  if (!rounds.length) return 'first';
  return rounds[rounds.length - 1].verdict === 'pass' && verdict === 'pass' ? 'confirm' : 'fix';
}

const emptyStage = () => ({ rounds: [], decisions: [] });
export const emptyLedger = () => ({ version: 1, stages: {} });
const stageOf = (ledger, stage) => ledger.stages[stage] || emptyStage();

/** Counted rounds, allowance and state of one stage. */
export function tally(ledger, stage) {
  const { rounds, decisions } = stageOf(ledger, stage);
  const counted = rounds.filter((r) => r.kind !== 'confirm').length;
  const fix = rounds.filter((r) => r.kind === 'fix').length;
  const extensions = decisions.filter((d) => d.decision === 'extend').length;
  const closed = decisions.find((d) => CLOSING.includes(d.decision)) || null;
  const allowance = CAP + extensions;
  const last = rounds[rounds.length - 1] || null;
  return { rounds: rounds.length, counted, fix, confirm: rounds.length - counted, extensions, allowance, closed, last, over: Math.max(0, counted - allowance) };
}

/** May the next round run? → { ok, reason } — pure. */
export function mayRun(ledger, stage) {
  const t = tally(ledger, stage);
  if (t.closed) return { ok: false, why: 'closed', t };
  if (t.counted < t.allowance) return { ok: true, why: 'budget', t };
  if (t.last && t.last.verdict === 'pass') return { ok: true, why: 'confirmation', t };
  return { ok: false, why: 'cap', t };
}

/** gate.sh's exit rule over one verdict-<label>.json → 'pass' | 'fail' | null (no verdict). */
export function verdictOf(v) {
  if (!v || typeof v !== 'object' || !v.pixel) return null;
  const probes = v.probes && typeof v.probes === 'object' ? v.probes : {};
  const rcs = Object.values(probes).map((p) => Number(p && p.rc));
  const pixel = Number(v.pixel.rc);
  if (![0, 2].includes(pixel) || rcs.some((rc) => ![0, 2].includes(rc))) return null;
  const rc = (name) => Number(probes[name]?.rc ?? 0);
  const fail = pixel === 2 || Number(v.structural) > 0 || Number(v.nothingLost) > 0
    || ['chrome-parity', 'clip-probe', 'content-presence', 'unit-geometry'].some((p) => rc(p) === 2);
  return fail ? 'fail' : 'pass';
}

export const stageOfVerdict = (label, v) => (/^pub/i.test(label) || Boolean(v?.probes?.['content-presence']) ? 'published' : 'prototype');

/** Rebuild a ledger from the verdict-*.json files of a gate dir (header § Reconstruction). `skipLabel`: this round's own file. */
export function reconstruct(dir, { skipLabel = null } = {}) {
  const ledger = emptyLedger();
  let names = [];
  try { names = readdirSync(dir); } catch { return ledger; }
  const found = [];
  for (const name of names) {
    const m = /^verdict-(.+)\.json$/.exec(name);
    if (!m || m[1] === skipLabel) continue;
    let v; let at;
    try { v = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    const verdict = verdictOf(v);
    if (!verdict) continue;
    try { at = typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at)) ? v.at : statSync(join(dir, name)).mtime.toISOString(); } catch { continue; }
    found.push({ label: String(v.round ?? m[1]), at, verdict, stage: stageOfVerdict(m[1], v) });
  }
  found.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.label.localeCompare(b.label));
  for (const { stage, ...r } of found) {
    const s = (ledger.stages[stage] ||= emptyStage());
    s.rounds.push({ ...r, kind: kindOf(s.rounds, r.verdict) });
  }
  if (found.length) ledger.reconstructed = new Date().toISOString();
  return ledger;
}

function valid(ledger) {
  return ledger && typeof ledger === 'object' && ledger.stages && typeof ledger.stages === 'object'
    && Object.values(ledger.stages).every((s) => s && Array.isArray(s.rounds) && Array.isArray(s.decisions));
}

/** The gate dir's ledger; rebuilt from the verdict files when rounds.json is absent or unreadable. */
export function load(dir, opts = {}) {
  const file = join(dir, LEDGER);
  if (existsSync(file)) {
    try {
      const ledger = JSON.parse(readFileSync(file, 'utf8'));
      if (valid(ledger)) return { ledger, source: 'ledger' };
    } catch { /* fall through: rebuild */ }
    return { ledger: reconstruct(dir, opts), source: 'reconstructed (rounds.json unreadable)' };
  }
  return { ledger: reconstruct(dir, opts), source: 'reconstructed' };
}

/** Atomic write: a sibling temp file, then rename — a crash leaves the previous ledger intact. */
export function save(dir, ledger) {
  const file = join(dir, LEDGER);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function record(ledger, stage, label, verdict, at = new Date().toISOString()) {
  const s = (ledger.stages[stage] ||= emptyStage());
  const round = { label, at, verdict, kind: kindOf(s.rounds, verdict) };
  s.rounds.push(round);
  return round;
}

/** Apply a decision → { error } or { entry }. `files`: the gate dir's file names (extend's evidence check). */
export function decide(ledger, stage, decision, reason, files = [], at = new Date().toISOString()) {
  if (!String(reason || '').trim()) return { error: 'a decision needs --reason' };
  const check = mayRun(ledger, stage);
  if (check.t.closed) return { error: `${stage} is already closed (${check.t.closed.decision})` };
  if (decision === 're-prototype') {
    // The rebuilt prototype is a new page to gate: both stages start again, once per gate dir; the spent rounds stay in `history`.
    if ((ledger.history || []).length) return { error: 'this page was already re-prototyped once — accept-residual is the remaining decision' };
    const entry = { decision, reason: reason.trim(), at, counted: check.t.counted, stage };
    (ledger.history ||= []).push({ stages: ledger.stages, decision: entry });
    ledger.stages = {};
    return { entry };
  }
  if (decision === 'extend') {
    if (check.t.extensions) return { error: 'the one extension of this page, width and stage is spent — decide accept-residual or re-prototype' };
    if (check.why !== 'cap') return { error: `extend applies only when the cap is reached (${check.t.counted} of ${check.t.allowance} counted rounds spent${check.why === 'confirmation' ? '; the last round passed — a confirmation is free' : ''})` };
    if (!files.some((f) => f !== LEDGER && reason.includes(f))) return { error: 'extend needs a --reason naming the instrument evidence: a file in the gate dir (e.g. live.capture.json, overflow-<label>.txt)' };
  }
  const s = (ledger.stages[stage] ||= emptyStage());
  const entry = { decision, reason: reason.trim(), at, counted: check.t.counted };
  s.decisions.push(entry);
  return { entry };
}

const describe = (t) => `${t.counted} of ${t.allowance} counted round${t.allowance === 1 ? '' : 's'} (first + ${t.fix} fix${t.confirm ? `, ${t.confirm} confirmation${t.confirm === 1 ? '' : 's'} free` : ''}${t.extensions ? `, ${t.extensions} extension${t.extensions === 1 ? '' : 's'}` : ''})`;

function statusLine(name, stage, t, rounds) {
  const state = t.closed ? `closed: ${t.closed.decision}` : t.over ? `OVER the cap by ${t.over}` : t.counted >= t.allowance ? 'cap reached' : `${t.allowance - t.counted} left`;
  const list = rounds.map((r) => `${r.label}:${r.verdict}${r.kind === 'confirm' ? '(confirm)' : ''}`).join(' ');
  return `${name} ${stage} — ${t.rounds ? describe(t) : '0 rounds'} — ${state}${list ? ` — ${list}` : ''}`;
}

/** Rows for every gate dir under a gates root that has rounds (ledger or verdict files). */
export function countAll(root) {
  const rows = [];
  let names = [];
  try { names = readdirSync(root).sort(); } catch { return rows; }
  for (const name of names) {
    const dir = join(root, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    const m = /^(.+)-(\d+)$/.exec(name);
    const { ledger, source } = load(dir);
    for (const stage of STAGES) {
      const t = tally(ledger, stage);
      if (!t.rounds && !stageOf(ledger, stage).decisions.length) continue;
      rows.push({ dir: name, slug: m ? m[1] : name, width: m ? Number(m[2]) : null, stage, rounds: t.rounds, counted: t.counted, fix: t.fix, confirm: t.confirm, allowance: t.allowance, over: t.over, decision: t.closed ? t.closed.decision : t.extensions ? `extend×${t.extensions}` : '', source: source === 'ledger' ? 'ledger' : 'verdict files' });
    }
  }
  return rows;
}

function help() {
  const src = readFileSync(SELF, 'utf8');
  return src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).split('\n').map((l) => l.replace(/^ \* ?/, '')).join('\n').trim();
}

function parse(argv) {
  const [cmd, target, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') { flags.json = true; continue; }
    if (!['--stage', '--label', '--verdict', '--decision', '--reason'].includes(a)) usage(`unknown argument ${a}`);
    if (rest[i + 1] === undefined) usage(`${a} needs a value`);
    flags[a.slice(2)] = rest[++i];
  }
  return { cmd, target, flags };
}

export function main(argv, env = process.env) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  const { cmd, target, flags } = parse(argv);
  if (!['check', 'record', 'decide', 'status', 'count'].includes(cmd)) usage(`unknown subcommand ${cmd}`);
  if (!target) usage(`${cmd} needs a ${cmd === 'count' ? 'gates root' : 'gate dir'}`);
  const need = (k, among) => {
    if (flags[k] === undefined) usage(`${cmd} needs --${k}`);
    if (among && !among.includes(flags[k])) usage(`--${k} is one of ${among.join(' | ')} (got ${flags[k]})`);
    return flags[k];
  };
  const name = basename(target.replace(/\/+$/, ''));

  if (cmd === 'count') {
    const rows = countAll(target);
    if (flags.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
    if (!rows.length) { console.log(`rounds: no gate dir with rounds under ${target}`); return 0; }
    const w = Math.max(8, ...rows.map((r) => r.dir.length));
    console.log(`${'gate dir'.padEnd(w)}  stage      rounds counted fix confirm cap over  decision  source`);
    for (const r of rows) console.log(`${r.dir.padEnd(w)}  ${r.stage.padEnd(9)}  ${String(r.rounds).padStart(6)} ${String(r.counted).padStart(7)} ${String(r.fix).padStart(3)} ${String(r.confirm).padStart(7)} ${String(r.allowance).padStart(3)} ${String(r.over).padStart(4)}  ${(r.decision || '-').padEnd(8)}  ${r.source}`);
    const over = rows.filter((r) => r.over > 0);
    console.log(`rounds: ${rows.length} (gate dir, stage) row(s); ${over.length} over the cap`);
    return 0;
  }

  if (cmd === 'status') {
    const { ledger, source } = load(target);
    if (flags.json) { console.log(JSON.stringify({ source, ledger, tally: Object.fromEntries(STAGES.map((s) => [s, tally(ledger, s)])) }, null, 2)); return 0; }
    for (const stage of [...STAGES, ...(stageOf(ledger, ROSTER_STAGE).rounds.length ? [ROSTER_STAGE] : [])]) console.log(statusLine(name, stage, tally(ledger, stage), stageOf(ledger, stage).rounds));
    if (source !== 'ledger') console.log(`rounds: ${source} from the verdict-*.json files in ${target}`);
    return 0;
  }

  const stage = need('stage', STAGES);

  if (cmd === 'check') {
    const label = need('label');
    const { ledger, source } = load(target);
    if (source !== 'ledger' && existsSync(target)) save(target, ledger);
    const { ok, why, t } = mayRun(ledger, stage);
    if (env.STARDUST_ROUND_CAP === '0') {
      console.log(`rounds: ${name} ${stage} — cap check off (STARDUST_ROUND_CAP=0); ${describe(t)}${ok ? '' : ' — this round would be refused'}`);
      return 0;
    }
    if (ok) {
      console.log(`rounds: ${name} ${stage} — round "${label}" may run: ${t.rounds ? describe(t) : 'the first round (the map)'}${why === 'confirmation' ? '; the last round passed, so a PASS here is its confirmation (a FAIL counts)' : ''}`);
      return 0;
    }
    const decideCmd = `node ${process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : 'stardust/scripts/replica/rounds.mjs'} decide ${target} --stage ${stage}`;
    if (why === 'closed') console.error(`rounds: ${name} ${stage} — round "${label}" refused: closed by the recorded decision ${t.closed.decision} ("${t.closed.reason}") after ${describe(t)} — act on it (source-fidelity-gate.md § Iteration discipline)`);
    else console.error(`rounds: ${name} ${stage} — round "${label}" refused: ${describe(t)} spent, the last one a FAIL. Two ways forward: (1) decide — ${decideCmd} --decision accept-residual|re-prototype --reason "<why>"; (2) only when a counted round measured an instrument defect — ${decideCmd} --decision extend --reason "<the evidence file and the defect>" (one more round)`);
    return 6;
  }

  if (cmd === 'record') {
    const label = need('label');
    const verdict = need('verdict', ['pass', 'fail']);
    const { ledger } = load(target, { skipLabel: label });
    const round = record(ledger, stage, label, verdict);
    save(target, ledger);
    const t = tally(ledger, stage);
    console.log(`rounds: ${name} ${stage} — recorded "${label}" ${verdict} as ${round.kind}: ${describe(t)}${t.over ? ` — OVER the cap by ${t.over}` : !t.closed && t.counted >= t.allowance && verdict === 'fail' ? ' — cap reached: the next round needs a decision (rounds.mjs decide)' : ''}`);
    return 0;
  }

  // decide
  const decision = need('decision', DECISIONS);
  const reason = need('reason');
  const { ledger } = load(target);
  let files = [];
  try { files = readdirSync(target); } catch { /* no gate dir: no evidence to name */ }
  const { error, entry } = decide(ledger, stage, decision, reason, files);
  if (error) { console.error(`rounds: ${name} ${stage} — ${error}`); return 1; }
  save(target, ledger);
  console.log(`rounds: ${name} ${stage} — decision ${entry.decision} recorded after ${entry.counted} counted round(s): ${decision === 'extend' ? 'one more counted round may run' : decision === 're-prototype' ? 'both stages start again for the rebuilt prototype' : 'closed — no further round'}`);
  return 0;
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === SELF; } catch { /* not the entry point */ }
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : `rounds: ${e.message}`);
    process.exitCode = e instanceof UsageError ? 125 : 1;
  }
}
