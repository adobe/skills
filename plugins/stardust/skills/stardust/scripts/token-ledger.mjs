#!/usr/bin/env node
/**
 * skills/stardust/scripts/token-ledger.mjs — the usage ledger per phase / wave / recorded unit; a table is always written.
 *
 * Renders `stardust/usage.md` + `stardust/usage.json` from the harness's session
 * transcripts, windowed by `stardust/status.jsonl` (`start` → `end` per phase; a
 * rollout wave = the span between consecutive rollout `start` lines), so "what
 * did each phase cost" is a table, not a recollection. It is advisory: it never
 * blocks a run and exits 0 except usage errors (exit 2) — the transcript paths it consults are harness
 * implementation details, not a documented API. It only READS `status.jsonl` (append-only,
 * harness-agnostic: no field is added there) and the two unit ledgers below; the
 * ledger is the artefact.
 *
 * Run it LAST in a hands-off run: at the handoff end, after the final session's last cost line — and
 * again whenever another session ran after it. Re-running is safe (idempotent) and `sessionsCovered`
 * shows what it covered, so a ledger written before later sessions is visibly stale.
 *
 * Coverage: usage.json carries top-level `writtenAt` (ISO) and `sessionsCovered: { count, first, last }`
 * — `count` = main session transcripts that contributed at least one request (subagent transcripts are
 * not sessions), `first` / `last` = the oldest / newest counted request timestamp (main or subagent).
 * usage.md shows it under the heading: `Written <writtenAt> · sessions covered <count> (last request
 * <last>)`. Unreachable transcripts: count 0, first / last `null` (`last request unknown`).
 *
 * Idempotent: when the rendered usage.md and usage.json equal the files on disk with their
 * writtenAt / generatedAt masked, nothing is written (writtenAt stays), the printed `usage:` line ends
 * `(unchanged)` and `--json` prints the record on disk; any other change rewrites both with a new
 * writtenAt. `--dry-run` never compares.
 *
 * Unreachable transcripts (no directory, a missing or unlistable one, no `*.jsonl` in it) still write the table: the
 * phase windows and unit rows with from / to, wall min and pages (they come from the ledgers), every
 * token / request cell `unknown` (JSON `null`, plus top-level `"usage": "unknown"` and `"unknownReason"`);
 * an open window or unit keeps an unknown end (`—`). It prints `usage: unknown (<why>) → stardust/usage.md
 * (windows without tokens)` (`--dry-run`: the bare `usage: unknown (<why>)`). With no window and no unit
 * row either, the table is one `usage: unknown (<why>)` row and nothing else.
 *
 * Unit rows: every recorded unit with a `startedAt` in `stardust/rollout/progress.json` (C-deliver)
 * and `stardust/migrate/progress.json` (migrate) — `{ "units": { "<name>": { status, kind, pages,
 * startedAt, endedAt, … } } }` — gets a `↳ <rollout|migrate> <name>` row directly under the phase
 * window holding its start (no `endedAt` → it ends at the last request). Unit timestamps are read as
 * instants (any ISO offset, shown in UTC); a unit whose `startedAt`/`endedAt` does not parse prints a
 * `usage:` note and gets no row. Unit rows are a breakdown:
 * the phase windows stay exclusive and the total is theirs; concurrent units, marked `(overlaps n)`,
 * share the main transcript's clock, so a request inside two of them counts in both. A file without a
 * `units` map (one archetype's bare record) prints `usage: <file> has no units map — unit rows skipped`.
 *
 * Discovery: `--transcripts <dir>` → else env `STARDUST_TRANSCRIPTS` → else the first harness project
 * dir `~/.<dot-dir>/projects/<project root, non-alphanumerics as '-'>/` (dot-dirs in sorted order)
 * whose transcripts carry `cwd` = the project root in their first 20 lines → else `unknown`. Main
 * transcripts (`<dir>/*.jsonl`) and subagent transcripts (`<dir>/<session>/subagents/*.jsonl`)
 * are both read — the latter as a separate `sub` column (fan-out runs carry most
 * of their tokens there). Requests are de-duplicated by `requestId` (fallback
 * `message.id`, max per field: a request's usage lines are cumulative).
 *
 * Columns: window · from · to · wall min · turns · prompts · acks · fresh · cache
 * write (1h / 5m) · cache read · output (thinking) · sub req / read / out · pages ·
 * tokens/page · est. cost (only with --prices). Unit rows carry the same columns, pages from the
 * unit's `pages`. Footer: session total, the harness-reported cost line when present (session-level,
 * not per phase), an `unwindowed` row so the table reconciles, and the retention hint when the
 * transcripts start after the project's first status line.
 *
 * Harness-reported cost (`harnessCost`): a session's cost-state lines are cumulative, so per transcript
 * file (a session) only its LAST cost line counts; `totalCostUSD` sums those across sessions, `sessions`
 * = the transcript files with a cost line, `models` = each model's `costUSD` summed across sessions.
 * `costLinesSeen` = how many cost lines were present at write time (main + subagent) and `lastCostAt` =
 * the newest one's timestamp, so a reader can tell a ledger run BEFORE the final session's last cost line
 * is one session short (a recorded run's harnessCost stopped one session short of the run's meter because
 * the ledger ran first) — run it after that line.
 *
 * Ported from the `stardust/next` branch (commits fb704109, 40a07747, ea00c4f4) as a file copy, not a
 * merge; the recorded-unit rows are this port's addition.
 *
 * Usage:
 *   node skills/stardust/scripts/token-ledger.mjs [--root <dir>] [--transcripts <dir>] [--windows <file>]
 *        [--prices <fresh,write,read,out>] [--json] [--dry-run]
 *     --transcripts <dir> the session transcripts (else env STARDUST_TRANSCRIPTS, else discovered)
 *     --windows <file>   override windows: [{ label, phase?, from, to }] (ISO timestamps)
 *     --prices f,w,r,o   four comma-separated numbers, USD per 1 M tokens (fresh, cache write,
 *                        cache read, output), supplied — never looked up; no price table ships
 *     --json             print usage.json on stdout too (the `usage:` lines go to stderr)
 *     --dry-run          print, write nothing
 *
 * Exit codes: 0 always (advisory) — `usage: unknown (…)` is a printed row, not a failure · 2 only for a
 * value flag followed by another flag (`--transcripts --dry-run`), decided before anything is read, and
 * for a root inside the plugin tree (the plugin is not a project), refused before anything is written.
 * Writes only stardust/usage.md and stardust/usage.json (tracked, provenance first), and neither when
 * unchanged. No network.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { // a value flag never swallows the next flag (`--root --json` is usage, not a root named --json)
  const i = args.indexOf(`--${n}`); if (i < 0) return undefined;
  const v = args[i + 1];
  if (v !== undefined && v.startsWith('--')) { console.error(`token-ledger: --${n} needs a value, got ${v} (--help)`); process.exit(2); }
  return v;
};
if (flag('help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
  process.exit(0);
}
for (const n of ['root', 'transcripts', 'windows', 'prices']) opt(n); // every value flag is checked before anything is read
const ACK = /^(c?co\s?n?tinue( now| the work)?|proceed|ok,? proceed|yes,? proceed|go|go on|go ahead|resume|keep going|ok go|yes|ok|okay|done|retry|(da )?token refreshed|next)[.!]?$/i;
const SKIP = [/^<command/, /^<local-command/, /^<system-reminder/, /^<task-notification/, /This session is being continued/];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// A stardust/ counts as a project dir only with a project marker (or a stardust-deps package.json) and never when it is
// the plugin itself (its dir is named `stardust`): the bare dir-name walk once picked `plugins/` as root from inside the
// plugin tree. The plugin tree is recognised by its `skills/stardust/SKILL.md`.
const isPluginDir = (d) => existsSync(join(d, 'skills', 'stardust', 'SKILL.md'));
const pluginTreeOf = (from) => { for (let d = resolve(from); ; d = dirname(d)) { if (isPluginDir(d)) return d; if (dirname(d) === d) return null; } };
const isProjectStardustDir = (sd) => existsSync(sd) && !isPluginDir(sd)
  && (['state.json', 'status.jsonl', 'journal.md', '.gitignore'].some((f) => existsSync(join(sd, f))) || readJson(join(sd, 'package.json'))?.name === 'stardust-deps');
function findRoot(from) {
  let d = resolve(from);
  for (;;) { if (isProjectStardustDir(join(d, 'stardust'))) return d; const up = dirname(d); if (up === d) return resolve(from); d = up; }
}
const root = opt('root') ? resolve(opt('root')) : findRoot(process.cwd());
const sd = join(root, 'stardust');
if (!opt('root') && !isProjectStardustDir(sd) && pluginTreeOf(root)) { console.error(`token-ledger: ${root} is inside the plugin tree ${pluginTreeOf(root)} — the plugin is not a project; run from the project root or pass --root <project>; nothing written`); process.exit(2); }
if (isPluginDir(sd)) { console.error(`token-ledger: ${sd} is the stardust plugin, not a project's stardust/ dir — pass --root <project>; nothing written`); process.exit(2); }
const readJsonl = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const note = (s) => (flag('json') ? console.error : console.log)(s); // stderr under --json: stdout stays the record

// --- discovery ------------------------------------------------------------------
const mangle = (rootDir) => rootDir.replace(/[^a-zA-Z0-9]/g, '-');
export function candidateDirs(rootDir, home = homedir()) {
  let dots = []; try { dots = readdirSync(home).filter((e) => e.startsWith('.')).sort(); } catch { /* no home dir */ }
  return dots.map((d) => join(home, d, 'projects', mangle(rootDir))).filter((p) => existsSync(p));
}
export function discover(rootDir, { home = homedir() } = {}) {
  const carries = (dir) => { try { return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).some((f) => readJsonl(join(dir, f)).slice(0, 20).some((l) => l.cwd && resolve(l.cwd) === resolve(rootDir))); } catch { return false; } };
  return candidateDirs(rootDir, home).find(carries) ?? null;
}
const envDir = process.env.STARDUST_TRANSCRIPTS || undefined;
const tSource = opt('transcripts') ? 'transcripts-dir' : envDir ? 'env' : 'discovered';
const tDir = opt('transcripts') ? resolve(opt('transcripts')) : envDir ? resolve(envDir) : discover(root);
// Unreachable transcripts do not end the run: the windows still render, every token / request cell `unknown`.
let unknownWhy = null;
if (!tDir) unknownWhy = `no transcript directory for ${root}; pass --transcripts <dir> or set STARDUST_TRANSCRIPTS`;
else if (!existsSync(tDir) || !statSync(tDir).isDirectory()) unknownWhy = `transcript directory ${tDir} does not exist or is not a directory`;

// --- transcripts ----------------------------------------------------------------
export function transcriptFiles(dir) {
  const main = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  const sub = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e, 'subagents');
    if (existsSync(p) && statSync(p).isDirectory()) for (const f of readdirSync(p)) if (f.endsWith('.jsonl')) sub.push(join(p, f));
  }
  return { main, sub };
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function usageOf(m) {
  const u = m?.message?.usage ?? m?.usage; if (!u) return null;
  return { fresh: num(u.input_tokens), cacheWrite: num(u.cache_creation_input_tokens), cacheWrite1h: num(u.cache_creation?.ephemeral_1h_input_tokens), cacheWrite5m: num(u.cache_creation?.ephemeral_5m_input_tokens), cacheRead: num(u.cache_read_input_tokens), output: num(u.output_tokens), thinking: num(u.output_tokens_details?.thinking_tokens ?? u.thinking_tokens) };
}
function userText(m) {
  const c = m?.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some((b) => b?.type === 'tool_result')) return null;
  return c.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n');
}
/** Read one transcript group: deduped requests (max per field; `file` = the transcript it was first seen in), prompts,
 *  acks, cost-state lines (with their `file`). */
export function readTranscripts(files) {
  const req = new Map(); const prompts = []; const costs = []; let oldest = null;
  for (const f of files) {
    for (const m of readJsonl(f)) {
      const ts = m.timestamp ?? m.ts ?? null;
      if (ts && (!oldest || ts < oldest)) oldest = ts;
      if (m.type === 'cost-state' || (m.totalCostUSD !== undefined && m.modelUsage)) { costs.push({ file: f, totalCostUSD: num(m.totalCostUSD), modelUsage: m.modelUsage ?? {}, startTime: m.startTime ?? null, ts }); continue; }
      const u = usageOf(m);
      if (u && (m.type === 'assistant' || m.message?.role === 'assistant')) {
        const key = m.requestId ?? (m.message?.id ? `mid:${m.message.id}` : `line:${f}:${req.size}`);
        const prev = req.get(key);
        const merged = prev ? Object.fromEntries(Object.keys(u).map((k) => [k, Math.max(prev[k], u[k])])) : u;
        req.set(key, { ...merged, ts: ts ?? prev?.ts ?? null, model: m.message?.model ?? prev?.model ?? null, file: prev?.file ?? f });
        continue;
      }
      if (m.type === 'user' || m.message?.role === 'user') {
        const text = userText(m); if (text === null) continue;
        const t = text.trim(); if (!t || SKIP.some((re) => re.test(t))) continue;
        prompts.push({ ts, ack: ACK.test(t) });
      }
    }
  }
  return { requests: [...req.values()], prompts, costs, oldest };
}

// --- windows --------------------------------------------------------------------
export function windowsFromStatus(lines) {
  const out = []; const open = new Map();
  const shortOf = (l) => String(l.skill ?? '?').replace(/^stardust:/, '');
  const key = (l) => `${shortOf(l)}|${l.phase}`; // stripped: `skill: "rollout"` and `"stardust:rollout"` are one skill
  for (const l of lines) {
    const short = shortOf(l);
    if (l.event === 'start') {
      if (short === 'rollout') for (const [k, w] of open) if (k.startsWith('rollout|') && !w.to) { w.to = l.ts; open.delete(k); } // a new wave closes the previous one
      const w = { label: `${short} ${l.phase}`, skill: short, phase: l.phase, from: l.ts, to: null, detail: null };
      out.push(w); open.set(key(l), w);
    } else if (l.event === 'end' || l.event === 'blocked') {
      const w = open.get(key(l));
      if (w) { w.to = l.ts; w.detail = l.detail ?? null; if (l.event === 'end') open.delete(key(l)); }
    }
  }
  return out;
}
const statusLines = readJsonl(join(sd, 'status.jsonl'));
const windows = opt('windows') ? (readJson(resolve(opt('windows'))) ?? []).map((w) => ({ label: w.label ?? w.phase, phase: w.phase ?? null, from: w.from, to: w.to, detail: w.detail ?? null })) : windowsFromStatus(statusLines);

// --- aggregate ------------------------------------------------------------------
let main = []; let sub = []; let tRead = false;
if (!unknownWhy) {
  try { ({ main, sub } = transcriptFiles(tDir)); tRead = true; } catch (e) { unknownWhy = `transcript directory ${tDir} is not readable (${e.code ?? e.message})`; }
}
if (!unknownWhy && !main.length && !sub.length) unknownWhy = `no *.jsonl under ${tDir}`;
const unknown = unknownWhy !== null;
const M = readTranscripts(main); const S = readTranscripts(sub);
const allTs = [...M.requests, ...S.requests].map((r) => r.ts).filter(Boolean).sort();
const sessionsCovered = { count: new Set(M.requests.map((r) => r.file)).size, first: allTs[0] ?? null, last: allTs.at(-1) ?? null };
for (const w of windows) if (!w.to) w.to = unknown ? null : (allTs.at(-1) ?? w.from); // unknown: the last request is unknown too
const endMs = (w) => (w.to ? Date.parse(w.to) : Infinity);
const inWin = (ts, w) => ts && ts >= w.from && ts <= w.to;
let prices = null; // four finite numbers per million tokens (fresh, cache write, cache read, output) — else the column is dropped, with a printed note
if (opt('prices') !== undefined) {
  const p = String(opt('prices')).split(',').map(Number);
  if (p.length === 4 && p.every(Number.isFinite)) prices = p;
  else note(`usage: --prices ignored — needs four numbers fresh,cacheWrite,cacheRead,output per M tokens, got ${JSON.stringify(opt('prices'))}`);
}
const zero = () => ({ turns: 0, prompts: 0, acks: 0, fresh: 0, cacheWrite: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0, thinking: 0, subRequests: 0, subRead: 0, subOut: 0 });
const rows = windows.map((w) => ({ ...w, ...zero() }));
const unw = { label: 'unwindowed', from: null, to: null, detail: null, ...zero() };
const place = (ts) => rows.find((w) => inWin(ts, w)) ?? unw;
const MAIN_KEYS = ['fresh', 'cacheWrite', 'cacheWrite1h', 'cacheWrite5m', 'cacheRead', 'output', 'thinking'];
const addMain = (w, r) => { w.turns += 1; for (const k of MAIN_KEYS) w[k] += r[k]; };
const addSub = (w, r) => { w.subRequests += 1; w.subRead += r.cacheRead + r.fresh + r.cacheWrite; w.subOut += r.output; };
const addPrompt = (w, p) => { w.prompts += 1; if (p.ack) w.acks += 1; };
for (const r of M.requests) addMain(place(r.ts), r);
for (const r of S.requests) addSub(place(r.ts), r);
for (const p of M.prompts) addPrompt(place(p.ts), p);

// --- recorded units (the C-deliver and migrate unit ledgers) --------------------
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Unit timestamps are hand-written (`date -Iseconds` gives `+02:00`), so they are read as instants and shown in UTC.
const utc = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? new Date(n).toISOString().replace(/\.000Z$/, 'Z') : null; };
/** One progress.json → { units (started, timestamps in UTC), skipped (names with an unparsable startedAt/endedAt) },
 *  or null when it has no `units` map (e.g. one archetype's bare record). */
export function unitsFrom(ledger, doc) {
  if (!isMap(doc) || !isMap(doc.units)) return null;
  const units = []; const skipped = [];
  for (const [name, u] of Object.entries(doc.units)) {
    if (!isMap(u) || u.startedAt == null) continue; // not started: no row
    const from = utc(u.startedAt); const to = u.endedAt == null ? null : utc(u.endedAt);
    if (!from || (u.endedAt != null && !to)) skipped.push(name); else units.push({ ledger, name, u, from, to });
  }
  return { units, skipped };
}
const unitFiles = []; const unitDefs = [];
for (const ledger of ['rollout', 'migrate']) {
  const rel = `stardust/${ledger}/progress.json`;
  if (!existsSync(join(root, rel))) continue;
  unitFiles.push(rel);
  const got = unitsFrom(ledger, readJson(join(root, rel)));
  if (!got) { note(`usage: ${rel} has no units map — unit rows skipped`); continue; }
  unitDefs.push(...got.units);
  for (const name of got.skipped) note(`usage: ${rel} unit ${name} has a startedAt/endedAt that is not an ISO timestamp — its row is skipped`);
}
// Counted by instant, never through place(): the phase windows stay exclusive and the total is theirs.
const msIn = (ts, a, b) => { const t = Date.parse(ts); return t >= a && t <= b; };
const unitRows = unitDefs.map(({ ledger, name, u, from, to }) => {
  const w = { label: `↳ ${ledger} ${name}`, ledger, name, kind: u.kind ?? null, status: u.status ?? null, from, to: to ?? (unknown ? null : utc(allTs.at(-1)) ?? from), parent: null, overlaps: [], ...zero() };
  const a = Date.parse(w.from); const b = endMs(w);
  const at = rows.findIndex((x) => Date.parse(x.from) <= a && a <= endMs(x)); // the phase row it renders under; rows.length = unwindowed
  if (at >= 0) w.parent = rows[at].label;
  for (const r of M.requests) if (msIn(r.ts, a, b)) addMain(w, r);
  for (const r of S.requests) if (msIn(r.ts, a, b)) addSub(w, r);
  for (const p of M.prompts) if (msIn(p.ts, a, b)) addPrompt(w, p);
  return { w, a, b, at: at >= 0 ? at : rows.length, pages: typeof u.pages === 'number' ? u.pages : null };
}).sort((x, y) => x.a - y.a);
for (const { w, a, b } of unitRows) w.overlaps = unitRows.filter((o) => o.w !== w && a <= o.b && o.a <= b).map(({ w: o }) => (o.ledger === w.ledger ? o.name : `${o.ledger} ${o.name}`));

const cost = (w) => (prices ? ((w.fresh * prices[0] + w.cacheWrite * prices[1] + w.cacheRead * prices[2] + w.output * prices[3]) / 1e6) : null);
const pagesIn = (detail) => { const m = detail?.match(/(\d+)\s*(?:\/\s*\d+\s*)?(pages|documents|urls)/i); return m ? Number(m[1]) : null; };
const TOKEN_KEYS = [...Object.keys(zero()), 'tokensPerPage', 'estCost'];
const blank = (w) => (unknown ? { ...w, ...Object.fromEntries(TOKEN_KEYS.map((x) => [x, null])) } : w); // unknown, never a zero
const finish = (w, pages = pagesIn(w.detail)) => {
  const total = w.fresh + w.cacheWrite + w.cacheRead + w.output;
  const wallMin = w.from && w.to ? Math.round((Date.parse(w.to) - Date.parse(w.from)) / 60_000) : null;
  return blank({ ...w, pages, tokensPerPage: pages && total ? Math.round(total / pages) : null, secondsPerPage: pages && wallMin !== null ? Math.round((wallMin * 60) / pages) : null, wallMin, estCost: cost(w) });
};
const single = unknown && !rows.length && !unitRows.length; // nothing to window either: one `usage: unknown (…)` row
const table = single ? [finish({ ...unw, label: `usage: unknown (${unknownWhy})` })] : [...rows.map((w) => finish(w)), finish(unw)];
const unitList = unitRows.map(({ w, at, pages }) => ({ at, row: finish(w, pages) }));
const units = unitList.map((x) => x.row);
const sum = table.reduce((a, w) => { for (const x of Object.keys(zero())) a[x] += w[x]; return a; }, zero());
sum.estCost = cost(sum);
const total = blank(sum);
// Cost-state lines are cumulative within a session: each transcript file's LAST line is its session's figure.
const allCosts = [...M.costs, ...S.costs];
const lastCostOf = new Map(); for (const c of allCosts) lastCostOf.set(c.file, c);
const lastCosts = [...lastCostOf.values()];
const usd = (n) => Math.round(n * 1e6) / 1e6; // float sums of cents stay 4.46, not 4.460000000000001
const modelCost = {}; for (const c of lastCosts) for (const [m, v] of Object.entries(c.modelUsage)) modelCost[m] = (modelCost[m] ?? 0) + num(v?.costUSD);
// costLinesSeen / lastCostAt: the number of cost lines present at write time and the newest one's timestamp, so a
// reader can tell a ledger run before the final session's last cost line is one session short (a recorded run's did).
const costTimes = allCosts.map((c) => c.ts).filter(Boolean).sort();
const harnessCost = lastCosts.length ? { totalCostUSD: usd(lastCosts.reduce((a, c) => a + c.totalCostUSD, 0)), sessions: lastCosts.length, costLinesSeen: allCosts.length, lastCostAt: costTimes.at(-1) ?? null, models: Object.fromEntries(Object.keys(modelCost).sort().map((m) => [m, usd(modelCost[m])])) } : null;
const firstStatus = statusLines[0]?.ts ?? null;
const oldest = [M.oldest, S.oldest].filter(Boolean).sort()[0] ?? null;
const retention = firstStatus && oldest && Date.parse(oldest) - Date.parse(firstStatus) > 3_600_000 ? `transcripts start ${oldest}, over an hour after the project's first status line ${firstStatus} — earlier windows are unrecoverable; keep the harness's transcript retention above the run's span (an owner setting)` : null;

// --- render ---------------------------------------------------------------------
const now = new Date().toISOString();
const fmt = (n) => (n === null || n === undefined ? '—' : typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n));
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));
const md = [];
md.push('<!-- stardust:provenance', '  writtenBy: stardust:stardust token-ledger.mjs', `  writtenAt: ${now}`, `  readArtifacts:`, `    - stardust/status.jsonl`, ...unitFiles.map((f) => `    - ${f}`), ...(tRead ? [`    - ${tDir}`] : []), '  synthesizedInputs: []', '-->', '', `# Usage — ${basename(root)}`, '');
md.push(`Written ${now} · sessions covered ${sessionsCovered.count} (last request ${sessionsCovered.last ?? (unknown ? 'unknown' : '—')})`, '');
md.push(unknown
  ? `Usage unknown (${unknownWhy}): the harness transcripts were not read, so every token and request cell reads \`unknown\`; windows, wall minutes and pages come from \`status.jsonl\` and the unit ledgers. Tokens are counts, not verdicts.`
  : `Advisory ledger from the harness transcripts (${main.length} main, ${sub.length} subagent); requests de-duplicated by requestId; windows from \`status.jsonl\`. Tokens are counts, not verdicts.`, '');
if (units.length) md.push('Unit rows (↳) break their phase down by the recorded units of the `progress.json` unit ledgers; they are not added to the total. A unit marked (overlaps n) ran beside n others on the same clock: a request inside both counts in both.', '');
const head = ['window', 'from', 'to', 'wall min', 'turns', 'prompts', 'acks', 'fresh', 'cache write (1h / 5m)', 'cache read', 'output (thinking)', 'sub req / read / out', 'pages', 'tokens/page', ...(prices ? ['est. USD'] : [])];
md.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
const tokenCells = (w) => (unknown ? Array(8).fill('unknown') : [w.turns, w.prompts, w.acks, k(w.fresh), `${k(w.cacheWrite)} (${k(w.cacheWrite1h)} / ${k(w.cacheWrite5m)})`, k(w.cacheRead), `${k(w.output)} (${k(w.thinking)})`, `${w.subRequests} / ${k(w.subRead)} / ${k(w.subOut)}`]);
const derived = (n) => (unknown ? 'unknown' : fmt(n));
const line = (w) => `| ${[w.label, w.from ?? '—', w.to ?? '—', fmt(w.wallMin), ...tokenCells(w), fmt(w.pages), derived(w.tokensPerPage), ...(prices ? [derived(w.estCost)] : [])].join(' | ')} |`;
table.forEach((w, i) => {
  md.push(line(w));
  for (const { at, row } of unitList) if (at === i) md.push(line({ ...row, label: row.overlaps.length ? `${row.label} (overlaps ${row.overlaps.length})` : row.label }));
});
if (!single) md.push(line({ ...total, label: '**total**', from: table[0]?.from ?? null, to: table.at(-2)?.to ?? null, wallMin: null, pages: null, tokensPerPage: null }));
md.push('');
if (harnessCost) md.push(`Harness-reported session cost (not per phase): USD ${harnessCost.totalCostUSD.toFixed(2)} over ${harnessCost.sessions} session(s), each session's last cost line${Object.keys(harnessCost.models).length ? ` — ${Object.entries(harnessCost.models).map(([m, c]) => `${m} ${c.toFixed(2)}`).join(', ')}` : ''}; ${harnessCost.costLinesSeen} cost line(s) seen, last ${harnessCost.lastCostAt ?? 'unknown'} (run after the final session's last cost line, or this is one session short).`, '');
if (retention) md.push(`Retention: ${retention}`, '');
const json = { _provenance: { writtenBy: 'stardust:stardust token-ledger.mjs', writtenAt: now }, writtenAt: now, generatedAt: now, sessionsCovered, ...(unknown ? { usage: 'unknown', unknownReason: unknownWhy } : {}), source: { harness: tSource, dir: tDir, main: main.length, sub: sub.length }, windows: table, units, total, harnessCost, retention, prices };
const mdText = `${md.join('\n')}\n`; let jsonText = `${JSON.stringify(json, null, 2)}\n`;

// Idempotent: the timestamps are the only lines a re-run over unchanged inputs changes; masked, the rest must match.
const mask = (s) => s.replace(/^(\s*"?(?:writtenAt|generatedAt)"?: "?)[^"\n]*/gm, '$1').replace(/^Written \S+ ·/m, 'Written ·');
let unchanged = false;
if (!flag('dry-run')) {
  const [mdP, jsonP] = [join(sd, 'usage.md'), join(sd, 'usage.json')];
  const [mdOld, jsonOld] = [mdP, jsonP].map((p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } });
  unchanged = mdOld !== null && jsonOld !== null && mask(mdOld) === mask(mdText) && mask(jsonOld) === mask(jsonText);
  if (unchanged) jsonText = jsonOld;
  else {
    mkdirSync(sd, { recursive: true });
    writeFileSync(mdP, mdText);
    writeFileSync(jsonP, jsonText);
  }
}
const kept = unchanged ? ' (unchanged)' : '';
if (unknown) note(`usage: unknown (${unknownWhy})${flag('dry-run') ? '' : ` → stardust/usage.md (windows without tokens)${kept}`}`);
if (flag('json')) process.stdout.write(jsonText);
else if (!unknown) {
  console.log(`usage: ${table.length - 1} window(s) + unwindowed${units.length ? ` + ${units.length} unit row(s)` : ''} · ${total.turns} requests (${total.subRequests} subagent) · fresh ${k(total.fresh)} · cache write ${k(total.cacheWrite)} · cache read ${k(total.cacheRead)} · output ${k(total.output)}${prices ? ` · est. USD ${total.estCost.toFixed(2)}` : ''}${harnessCost ? ` · harness-reported USD ${harnessCost.totalCostUSD.toFixed(2)} (session, not per phase)` : ''} → ${flag('dry-run') ? '(dry run)' : `${join(sd, 'usage.md')}${kept}`}`);
  if (retention) console.log(`usage: ${retention}`);
}
process.exit(0);
