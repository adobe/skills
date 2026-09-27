#!/usr/bin/env node
// skills/stardust/scripts/decide.mjs — the decision layer (#127): one typed judgment battery, one
// System One request, one ledger line. Code owns the state, the options and the thresholds; the model
// (TypeSafe Jev by default) returns typed answers with probabilities; this script routes them
// (`act` / `review` / `escalate`) and records everything to `stardust/decisions.jsonl` so a threshold
// can be retuned later without re-inference. It never generates text: every option a battery offers
// comes from the battery file or from the state the caller built.
//
//   node decide.mjs <battery> --state <file.json|-> [--ref <slug or id>] [--mode off|shadow|assist|gate]
//                   [--agent '<json>'] [--run-id <id>] [--model jev-1.13.0] [--dry-run] [--pretty]
//                   [--no-cache] [--cache <dir>] [--ledger <file>] [--no-ledger]
//                   [--key-env TYPESAFE_API_KEY] [--endpoint <url>] [--batteries <dir>]
//                   [--retries 5] [--backoff-ms 500]
//   node decide.mjs batteries [--batteries <dir>]          list the shipped batteries
//   node decide.mjs compare [--ledger <file>] [--battery <b>] [--run-id <id>] [--check] [--json]
//   node decide.mjs --help
//
// Modes (`--mode`, default $STARDUST_DECIDER, else `shadow` for a direct call): `off` prints
// {"decider":"off"} and exits 3 — the caller keeps its own judgment (the "without" arm); `shadow` —
// the caller has decided already and passes its answer with --agent; both answers are logged, a
// disagreement at or above the question's `act` bar sets `shadow.review: true`, nothing else changes;
// `assist` — the caller asks first and confirms or overrides (its override, when given later with
// --agent, is logged the same way); `gate` — the caller takes an `act` verdict without review (only
// for batteries that earned it in evals/jev-batteries/BASELINE.md). `--decider jev|off` is the older
// spelling (jev = assist). Every line carries `mode` and `runId` (--run-id, else
// stardust/state.json#runId, else $STARDUST_RUN_ID, else the UTC date).
// --agent '<json>': the caller's own answer per question id ({"type":"article","locale_shell":false});
// choice compares the option, score the rounded level, noul the boolean; per-question `agreement`
// lands in the line. `compare` reads the ledger back: per battery and question, items, items with an
// agent answer, agreement overall and per confidence bin, route split; `--check` validates every
// line's shape and exits 2 on the first bad one.
//
// Battery: `<batteries>/<name>.json` (default: the `batteries/` dir beside this script, so a project
// copy under stardust/scripts/stardust/ carries them) or any path ending in .json. Shape and the
// authoring rules: batteries/README.md. A question may take its options from the state
// (`criteriaFrom: "<path>"`, array → option names, object → name: description) and append a
// no-match option (`appendNone`); `route` names the thresholds per question.
// State: a JSON object (named fields the questions reference in backticks). `-` reads stdin.
// Output: one JSON object on stdout — battery, model, answers (with full probabilities), route
// (per question and overall, plus the weakest judgment), usage, ms, cached. `--dry-run` prints the
// built request instead and touches nothing. `--decider off` (or STARDUST_DECIDER=off) prints
// {"decider":"off"} and exits 3 so a caller falls back to its own judgment; a missing key exits 3 too.
// Cache: `stardust/.work/decide/<sha>.json` keyed on model + state + questions (run residue).
// Ledger: `stardust/decisions.jsonl`, one line per decision (never per cache hit unless --ref differs).
// Retries: 429 / 529 / 5xx and network errors, exponential backoff from --backoff-ms, Retry-After
// honoured, at most --retries attempts. The endpoint accepts about eight concurrent requests in
// practice; callers fanning out should stay near that.
// Exit codes: 0 answered · 2 usage or battery error · 3 decider off / no key · 4 API failure.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = {
  model: 'jev-1.13.0',
  endpoint: process.env.STARDUST_DECIDE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone', // the env override exists for tests of wired steps
  keyEnv: 'TYPESAFE_API_KEY',
  decider: 'jev',
  retries: 5,
  backoffMs: 500,
  backoffMaxMs: 20000,
  concurrency: 8,
  cacheDir: 'stardust/.work/decide',
  ledger: 'stardust/decisions.jsonl',
  batteriesDir: join(HERE, 'batteries'),
};
export const META_KEYS = ['criteriaFrom', 'appendNone', 'notes'];
export const MODES = ['off', 'shadow', 'assist', 'gate'];
export const LINE_KEYS = ['at', 'runId', 'mode', 'battery', 'version', 'model', 'answers', 'route'];
export const BINS = [['≥0.9', 0.9, 1.01], ['0.7–0.9', 0.7, 0.9], ['0.5–0.7', 0.5, 0.7], ['<0.5', -1, 0.5]];
export const PRIMITIVES = ['noul', 'choice', 'score'];
export const VERDICTS = ['act', 'review', 'escalate'];
const SEVERITY = { act: 0, review: 1, escalate: 2 };

// ---- pure helpers ---------------------------------------------------------------------------------

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha = (text) => createHash('sha256').update(text).digest('hex');
export const cacheKey = (model, state, questions) => sha(stable({ model, state, questions }));

export function getPath(obj, path) {
  return String(path).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function loadBattery(nameOrPath, batteriesDir = DEFAULTS.batteriesDir) {
  const file = nameOrPath.endsWith('.json') ? resolve(nameOrPath) : join(batteriesDir, `${nameOrPath}.json`);
  if (!existsSync(file)) throw usage(`battery not found: ${file} (node decide.mjs batteries lists them)`);
  let b;
  try { b = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw usage(`battery ${file} is not JSON: ${e.message}`); }
  if (!b.name || !b.questions || typeof b.questions !== 'object') throw usage(`battery ${file} needs "name" and "questions"`);
  b.file = file;
  return b;
}

export function listBatteries(batteriesDir = DEFAULTS.batteriesDir) {
  if (!existsSync(batteriesDir)) return [];
  return readdirSync(batteriesDir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try { const b = JSON.parse(readFileSync(join(batteriesDir, f), 'utf8')); return { name: b.name || basename(f, '.json'), version: b.version ?? null, questions: Object.keys(b.questions || {}).length, description: b.description || '' }; } catch { return { name: basename(f, '.json'), error: 'not JSON' }; }
  });
}

// Build the API `questions` map from a battery and a state: fill criteriaFrom, append the no-match
// option, strip authoring metadata, validate shapes against the API limits.
export function buildQuestions(battery, state) {
  const out = {};
  for (const [id, spec] of Object.entries(battery.questions)) {
    if (!PRIMITIVES.includes(spec.type)) throw usage(`question ${id}: type must be one of ${PRIMITIVES.join('|')}`);
    if (!spec.instructions) throw usage(`question ${id}: instructions are required`);
    const q = { type: spec.type, instructions: spec.instructions };
    let criteria = spec.criteria;
    if (spec.criteriaFrom) {
      const from = getPath(state, spec.criteriaFrom);
      if (from == null) throw usage(`question ${id}: criteriaFrom "${spec.criteriaFrom}" is missing from the state`);
      if (spec.type === 'choice') {
        if (Array.isArray(from)) criteria = Object.fromEntries(from.map((k) => [String(k), null]));
        else if (typeof from === 'object') criteria = { ...from };
        else throw usage(`question ${id}: criteriaFrom must point at an array or an object`);
      } else if (spec.type === 'score') {
        if (!Array.isArray(from)) throw usage(`question ${id}: a score's criteriaFrom must point at an ordered array`);
        criteria = [...from];
      } else throw usage(`question ${id}: criteriaFrom is only for choice and score`);
    }
    if (spec.type === 'choice') {
      criteria = { ...(criteria || {}) };
      if (spec.appendNone) {
        const none = typeof spec.appendNone === 'string' ? { none: spec.appendNone } : spec.appendNone;
        Object.assign(criteria, none);
      }
      const n = Object.keys(criteria).length;
      if (n < 2) throw usage(`question ${id}: a choice needs at least 2 options (has ${n})`);
      if (n > 255) throw usage(`question ${id}: a choice takes at most 255 options (has ${n}); narrow in two stages`);
      q.criteria = criteria;
    } else if (spec.type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) throw usage(`question ${id}: a score needs 2 to 10 ordered levels`);
      q.criteria = criteria;
    } else if (criteria) {
      q.criteria = criteria;
    }
    out[id] = q;
  }
  return out;
}

// Route answers through the battery's thresholds. For choice/score the answer's `confidence` is
// compared with route.<id>.confident / .review (act ≥ confident, review ≥ review, else escalate);
// for a noul, route.<id>.yes / .no split into yes / no / review. Overall = the worst verdict among
// routed questions (review and escalate outrank act; a noul's `review` counts as review). `weakest`
// names the least confident routed judgment — the function-calling rule: one shaky argument spoils
// the call, so the minimum, not the product, is the call's confidence.
export function route(battery, answers) {
  const rules = battery.route || {};
  const per = {};
  let overall = 'act';
  let weakest = null;
  for (const [id, rule] of Object.entries(rules)) {
    const a = answers[id];
    if (!a) { per[id] = { verdict: 'escalate', why: 'no answer' }; overall = 'escalate'; continue; }
    let verdict; let measure;
    if (a.type === 'noul') {
      const yes = rule.yes ?? 0.8; const no = rule.no ?? 0.2;
      measure = a.noul;
      verdict = a.noul >= yes ? 'yes' : a.noul <= no ? 'no' : 'review';
      per[id] = { verdict, noul: a.noul, yes, no };
      const sev = verdict === 'review' ? 'review' : 'act';
      if (SEVERITY[sev] > SEVERITY[overall]) overall = sev;
      const distance = Math.min(Math.abs(a.noul - yes), Math.abs(a.noul - no));
      if (!weakest || distance < weakest.margin) weakest = { question: id, margin: distance, measure };
    } else {
      const confident = rule.confident ?? 0.8; const rev = rule.review ?? 0.5;
      measure = a.confidence ?? 0;
      verdict = measure >= confident ? 'act' : measure >= rev ? 'review' : 'escalate';
      const chosen = a.type === 'choice' ? a.choice : a.score;
      if (a.type === 'choice' && rule.noneIs && a.choice === rule.noneIs && verdict === 'act') verdict = 'review';
      per[id] = { verdict, confidence: measure, chosen, confident, review: rev };
      if (SEVERITY[verdict] > SEVERITY[overall]) overall = verdict;
      if (!weakest || measure < weakest.measure) weakest = { question: id, margin: measure, measure };
    }
  }
  return { overall, questions: per, weakest };
}

export function usage(message) { const e = new Error(message); e.exitCode = 2; return e; }

// Compare the caller's answer with the model's, per question: choice → the option, score → the
// rounded level, noul → the boolean at 0.5. Questions the caller did not answer are null.
export function agreement(answers, agent) {
  if (!agent || typeof agent !== 'object') return null;
  const out = {};
  for (const [id, a] of Object.entries(answers || {})) {
    if (!(id in agent)) { out[id] = null; continue; }
    const v = agent[id];
    if (a.type === 'choice') out[id] = String(a.choice) === String(v);
    else if (a.type === 'score') out[id] = Math.round(a.score) === Math.round(Number(v));
    else out[id] = (a.noul >= 0.5) === (v === true || v === 'true' || v === 'yes' || v === 1);
  }
  return out;
}

// The confidence a line's question carries, on one scale: choice/score confidence, noul distance from 0.5 doubled.
export const questionConfidence = (a) => (a.type === 'noul' ? Math.abs(a.noul - 0.5) * 2 : (a.confidence ?? 0));
export const bin = (c) => (BINS.find(([, lo, hi]) => c >= lo && c < hi) || BINS[3])[0];

// The run's decider mode for a wired step: $STARDUST_DECIDER, else off. A wired step never blocks:
// off or no key → it prints one skip line and returns; a call failure is logged, never thrown up.
export function wiredMode() { try { return normaliseMode(process.env.STARDUST_DECIDER) || 'off'; } catch { return 'off'; } }

export function normaliseMode(raw) {
  if (raw == null || raw === '') return null;
  const m = String(raw).toLowerCase();
  if (m === 'jev') return 'assist';
  if (!MODES.includes(m)) throw usage(`mode must be one of ${MODES.join('|')}, got "${raw}"`);
  return m;
}

export function resolveRunId(explicit, cwd = process.cwd()) {
  if (explicit) return String(explicit);
  try { const st = JSON.parse(readFileSync(join(cwd, 'stardust', 'state.json'), 'utf8')); if (st && st.runId) return String(st.runId); } catch { /* no state */ }
  if (process.env.STARDUST_RUN_ID) return process.env.STARDUST_RUN_ID;
  return new Date().toISOString().slice(0, 10);
}

// Read a decisions ledger back into per-battery, per-question agreement tables.
export function readLedger(file) {
  if (!existsSync(file)) throw usage(`ledger not found: ${file}`);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = []; const bad = [];
  lines.forEach((l, i) => { try { const j = JSON.parse(l); const missing = LINE_KEYS.filter((k) => !(k in j)); if (missing.length) bad.push({ line: i + 1, why: `missing ${missing.join(', ')}` }); else out.push(j); } catch (e) { bad.push({ line: i + 1, why: `not JSON: ${e.message}` }); } });
  return { lines: out, bad };
}

export function compareLedger(lines, { battery = null, runId = null } = {}) {
  const tables = {};
  for (const l of lines) {
    if (battery && l.battery !== battery) continue;
    if (runId && l.runId !== runId) continue;
    const B = (tables[l.battery] ||= { items: 0, withAgent: 0, modes: {}, route: { act: 0, review: 0, escalate: 0 }, shadowReview: 0, questions: {} });
    B.items += 1; B.modes[l.mode] = (B.modes[l.mode] || 0) + 1;
    if (l.route && l.route.overall) B.route[l.route.overall] = (B.route[l.route.overall] || 0) + 1;
    if (l.shadow && l.shadow.review) B.shadowReview += 1;
    if (l.agent) B.withAgent += 1;
    for (const [q, a] of Object.entries(l.answers || {})) {
      const Q = (B.questions[q] ||= { n: 0, withAgent: 0, agree: 0, bins: Object.fromEntries(BINS.map(([b]) => [b, { n: 0, agree: 0 }])) });
      Q.n += 1;
      const ag = l.agreement ? l.agreement[q] : null;
      if (ag === null || ag === undefined) continue;
      const c = bin(questionConfidence(a));
      Q.withAgent += 1; Q.bins[c].n += 1;
      if (ag) { Q.agree += 1; Q.bins[c].agree += 1; }
    }
  }
  return tables;
}

export function formatCompare(tables) {
  const pct = (a, n) => (n ? `${Math.round((a / n) * 1000) / 10}%` : '—');
  const out = [];
  for (const [b, B] of Object.entries(tables)) {
    out.push(`${b}: ${B.items} decision(s), ${B.withAgent} with an agent answer; modes ${Object.entries(B.modes).map(([m, n]) => `${m} ${n}`).join(', ')}; route act ${B.route.act} / review ${B.route.review} / escalate ${B.route.escalate}; shadow review ${B.shadowReview}`);
    out.push('  question            n  agent  agree   ≥0.9        0.7–0.9     0.5–0.7     <0.5');
    for (const [q, Q] of Object.entries(B.questions)) {
      const bins = BINS.map(([name]) => `${pct(Q.bins[name].agree, Q.bins[name].n).padStart(6)} (${String(Q.bins[name].n).padStart(3)})`).join(' ');
      out.push(`  ${q.padEnd(18)} ${String(Q.n).padStart(4)} ${String(Q.withAgent).padStart(5)}  ${pct(Q.agree, Q.withAgent).padStart(6)} ${bins}`);
    }
  }
  return out.join('\n') || 'no decisions match';
}

export function helpText() {
  return readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

// ---- client --------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export function createClient({ key, endpoint = DEFAULTS.endpoint, model = DEFAULTS.model, fetchImpl = globalThis.fetch, retries = DEFAULTS.retries, backoffMs = DEFAULTS.backoffMs, backoffMaxMs = DEFAULTS.backoffMaxMs, concurrency = DEFAULTS.concurrency } = {}) {
  if (!key) throw Object.assign(new Error('no API key'), { exitCode: 3 });
  let active = 0; const queue = [];
  const acquire = () => new Promise((r) => { if (active < concurrency) { active += 1; r(); } else queue.push(r); });
  const release = () => { active -= 1; const next = queue.shift(); if (next) { active += 1; next(); } };
  async function systemOne(state, questions, opts = {}) {
    const body = JSON.stringify({ model: opts.model || model, state, questions });
    await acquire();
    const t0 = Date.now(); // after the slot: latency, not queue wait
    try {
      let attempt = 0; let lastErr;
      while (attempt < retries) {
        attempt += 1;
        let res;
        try {
          res = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body });
        } catch (e) { lastErr = e; }
        if (res) {
          if (res.ok) { const j = await res.json(); Object.defineProperty(j, '_latencyMs', { value: Date.now() - t0, enumerable: false }); return j; }
          const text = await res.text().catch(() => '');
          lastErr = Object.assign(new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`), { status: res.status });
          if (![429, 529].includes(res.status) && res.status < 500) throw Object.assign(lastErr, { exitCode: res.status === 401 ? 3 : 4 });
          const ra = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : 0);
          if (ra > 0) { await sleep(Math.min(ra * 1000, backoffMaxMs)); continue; }
        }
        if (attempt < retries) await sleep(Math.min(backoffMs * 2 ** (attempt - 1), backoffMaxMs));
      }
      throw Object.assign(lastErr || new Error('request failed'), { exitCode: 4 });
    } finally { release(); }
  }
  return { systemOne, model };
}

// ---- decide ----------------------------------------------------------------------------------------

export async function decide({ battery, state, client, model = client.model, cacheDir = DEFAULTS.cacheDir, ledger = DEFAULTS.ledger, ref = null, noCache = false, mode = 'shadow', agent = null, runId = null, now = () => new Date() }) {
  const questions = buildQuestions(battery, state);
  const key = cacheKey(model, state, questions);
  const cacheFile = cacheDir ? join(cacheDir, `${key}.json`) : null;
  let response; let cached = false; let ms = 0;
  if (!noCache && cacheFile && existsSync(cacheFile)) {
    try { response = JSON.parse(readFileSync(cacheFile, 'utf8')).response; cached = true; } catch { response = null; }
  }
  if (!response) {
    const t0 = Date.now();
    response = await client.systemOne(state, questions, { model });
    ms = response._latencyMs ?? (Date.now() - t0);
    if (cacheFile) { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ at: now().toISOString(), model: response.model, response }, null, 0)); }
  }
  const routed = route(battery, response.answers || {});
  const agree = agreement(response.answers || {}, agent);
  const result = { runId: runId || resolveRunId(null), mode, battery: battery.name, version: battery.version ?? null, model: response.model || model, ref, answers: response.answers, route: routed, usage: response.usage || null, ms, cached };
  if (agent) {
    result.agent = agent; result.agreement = agree;
    // shadow: a disagreement the model is confident about is worth a look — flag it, change nothing.
    const rules = battery.route || {};
    const disagree = Object.entries(agree).filter(([q, ok]) => ok === false).filter(([q]) => { const a = response.answers[q]; const r = rules[q] || {}; if (!a) return false; if (a.type === 'noul') return a.noul >= (r.yes ?? 0.8) || a.noul <= (r.no ?? 0.2); return (a.confidence ?? 0) >= (r.confident ?? 0.8); }).map(([q]) => q);
    result.shadow = { disagree, review: disagree.length > 0 };
  }
  if (ledger) {
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, `${JSON.stringify({ at: now().toISOString(), ...result, stateSha: sha(stable(state)).slice(0, 16) })}\n`);
  }
  return result;
}

// ---- CLI --------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { positional: [], mode: null, agent: null, runId: null, battery: null, check: false, json: false, model: DEFAULTS.model, keyEnv: DEFAULTS.keyEnv, endpoint: DEFAULTS.endpoint, batteries: DEFAULTS.batteriesDir, cache: DEFAULTS.cacheDir, ledger: DEFAULTS.ledger, retries: DEFAULTS.retries, backoffMs: DEFAULTS.backoffMs, noCache: false, dryRun: false, pretty: false, ref: null, state: null };
  const val = (flag, v) => { if (v === undefined || v.startsWith('--')) throw usage(`${flag} needs a value`); return v; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--state') o.state = val(a, argv[++i]);
    else if (a === '--ref') o.ref = val(a, argv[++i]);
    else if (a === '--model') o.model = val(a, argv[++i]);
    else if (a === '--decider' || a === '--mode') o.mode = normaliseMode(val(a, argv[++i]));
    else if (a === '--agent') { const raw = val(a, argv[++i]); try { o.agent = JSON.parse(raw); } catch (e) { throw usage(`--agent must be a JSON object: ${e.message}`); } if (!o.agent || typeof o.agent !== 'object' || Array.isArray(o.agent)) throw usage('--agent must be a JSON object of question id → answer'); }
    else if (a === '--run-id') o.runId = val(a, argv[++i]);
    else if (a === '--battery') o.battery = val(a, argv[++i]);
    else if (a === '--check') o.check = true;
    else if (a === '--json') o.json = true;
    else if (a === '--key-env') o.keyEnv = val(a, argv[++i]);
    else if (a === '--endpoint') o.endpoint = val(a, argv[++i]);
    else if (a === '--batteries') o.batteries = resolve(val(a, argv[++i]));
    else if (a === '--cache') o.cache = val(a, argv[++i]);
    else if (a === '--ledger') o.ledger = val(a, argv[++i]);
    else if (a === '--retries') o.retries = Number(val(a, argv[++i]));
    else if (a === '--backoff-ms') o.backoffMs = Number(val(a, argv[++i]));
    else if (a === '--no-cache') o.noCache = true;
    else if (a === '--no-ledger') o.ledger = null;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--pretty') o.pretty = true;
    else if (a.startsWith('--')) throw usage(`unknown flag ${a}`);
    else o.positional.push(a);
  }
  return o;
}

async function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(helpText()); return 0; }
  const o = parseArgs(argv);
  const [cmd] = o.positional;
  if (cmd === 'batteries') {
    for (const b of listBatteries(o.batteries)) console.log(b.error ? `${b.name}  (${b.error})` : `${b.name}  v${b.version ?? '?'}  ${b.questions} question(s)  ${b.description}`);
    return 0;
  }
  if (cmd === 'compare') {
    const { lines, bad } = readLedger(o.ledger || DEFAULTS.ledger);
    if (o.check) { for (const b of bad) console.error(`decide compare --check: line ${b.line}: ${b.why}`); if (bad.length) return 2; console.log(`decisions ledger ok: ${lines.length} line(s)`); }
    else if (bad.length) console.error(`decide compare: ${bad.length} unreadable line(s) skipped (run --check)`);
    const tables = compareLedger(lines, { battery: o.battery, runId: o.runId });
    console.log(o.json ? JSON.stringify(tables, null, o.pretty ? 2 : 0) : formatCompare(tables));
    return 0;
  }
  if (!cmd) throw usage('give a battery name (node decide.mjs batteries), compare, or --help');
  const battery = loadBattery(cmd, o.batteries);
  if (!o.state) throw usage('--state <file.json|-> is required');
  let state;
  try { state = JSON.parse(o.state === '-' ? readFileSync(0, 'utf8') : readFileSync(o.state, 'utf8')); } catch (e) { throw usage(`state is not readable JSON: ${e.message}`); }
  if (!state || typeof state !== 'object') throw usage('state must be a JSON object or array');
  if (o.dryRun) {
    console.log(JSON.stringify({ battery: battery.name, model: o.model, state, questions: buildQuestions(battery, state), route: battery.route || {} }, null, o.pretty ? 2 : 0));
    return 0;
  }
  const mode = o.mode || normaliseMode(process.env.STARDUST_DECIDER) || 'shadow';
  if (mode === 'off') { console.log(JSON.stringify({ decider: 'off', mode, battery: battery.name })); return 3; }
  const key = process.env[o.keyEnv];
  if (!key) { console.error(`decide: no key in $${o.keyEnv} — export it (never in a file the skills push) or run with --decider off`); return 3; }
  const client = createClient({ key, endpoint: o.endpoint, model: o.model, retries: o.retries, backoffMs: o.backoffMs });
  const result = await decide({ battery, state, client, model: o.model, cacheDir: o.noCache ? null : o.cache, ledger: o.ledger, ref: o.ref, noCache: o.noCache, mode, agent: o.agent, runId: resolveRunId(o.runId) });
  console.log(JSON.stringify(result, null, o.pretty ? 2 : 0));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => { console.error(`decide: ${e.message}`); process.exit(e.exitCode || 4); });
}
