#!/usr/bin/env node
/**
 * skills/stardust/scripts/token-ledger.mjs — the optional usage ledger per phase / wave.
 *
 * Renders `stardust/usage.md` + `stardust/usage.json` from the harness's session
 * transcripts, windowed by `stardust/status.jsonl` (`start` → `end` per phase; a
 * rollout wave = the span between consecutive rollout `start` lines), so "what
 * did each phase cost" is a table, not a recollection. It is advisory: it never
 * blocks a run, always exits 0, and prints `usage: unknown (…)` when anything it
 * reads is missing — the transcript paths it consults are harness implementation
 * details, not a documented API. It only READS `status.jsonl` (append-only,
 * harness-agnostic: no field is added there); the ledger is the artefact.
 *
 * Discovery: `--transcripts <dir>` → else the Claude Code project dir whose
 * transcripts carry `cwd` = the project root → else `unknown`. Main transcripts
 * (`<dir>/*.jsonl`) and subagent transcripts (`<dir>/<session>/subagents/*.jsonl`)
 * are both read — the latter as a separate `sub` column (fan-out runs carry most
 * of their tokens there). Requests are de-duplicated by `requestId` (fallback
 * `message.id`, max per field: a request's usage lines are cumulative).
 *
 * Columns: window · from · to · wall min · turns · prompts · acks · fresh · cache
 * write (1h / 5m) · cache read · output (thinking) · sub req / read / out · pages ·
 * tokens/page · est. cost (only with --prices). Footer: session total, the
 * harness-reported cost line when present (session-level, not per phase), an
 * `unwindowed` row so the table reconciles, and the retention hint when the
 * transcripts start after the project's first status line.
 *
 * Usage:
 *   node skills/stardust/scripts/token-ledger.mjs [--root <dir>] [--transcripts <dir>] [--windows <file>]
 *        [--prices <fresh,write,read,out>] [--json] [--dry-run]
 *     --windows <file>   override windows: [{ label, phase?, from, to }] (ISO timestamps)
 *     --prices f,w,r,o   USD per 1 M tokens, supplied — never looked up
 *     --json             print usage.json on stdout too
 *     --dry-run          print, write nothing
 *
 * Exit codes: 0 always (advisory) — `usage: unknown (…)` is a printed row, not a failure.
 * Writes only stardust/usage.md and stardust/usage.json (tracked, provenance first). No network.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (flag('help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim());
  process.exit(0);
}
const ACK = /^(c?co\s?n?tinue( now| the work)?|proceed|ok,? proceed|yes,? proceed|go|go on|go ahead|resume|keep going|ok go|yes|ok|okay|done|retry|(da )?token refreshed|next)[.!]?$/i;
const SKIP = [/^<command/, /^<local-command/, /^<system-reminder/, /^<task-notification/, /This session is being continued/];

function findRoot(from) {
  let d = resolve(from);
  for (;;) { if (existsSync(join(d, 'stardust'))) return d; const up = dirname(d); if (up === d) return resolve(from); d = up; }
}
const root = opt('root') ? resolve(opt('root')) : findRoot(process.cwd());
const sd = join(root, 'stardust');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readJsonl = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const unknown = (why) => { console.log(`usage: unknown (${why})`); process.exit(0); };

// --- discovery ------------------------------------------------------------------
export function candidateDir(rootDir, home = homedir()) { return join(home, '.claude', 'projects', rootDir.replace(/[^a-zA-Z0-9]/g, '-')); }
export function discover(rootDir, { home = homedir() } = {}) {
  const dir = candidateDir(rootDir, home);
  if (!existsSync(dir)) return null;
  const ok = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).some((f) => readJsonl(join(dir, f)).slice(0, 20).some((l) => l.cwd && resolve(l.cwd) === resolve(rootDir)));
  return ok ? dir : null;
}
const tDir = opt('transcripts') ? resolve(opt('transcripts')) : discover(root);
if (!tDir || !existsSync(tDir)) unknown(`no transcript directory for ${root}; pass --transcripts <dir>`);

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
/** Read one transcript group: deduped requests (max per field), prompts, acks, cost-state lines. */
export function readTranscripts(files) {
  const req = new Map(); const prompts = []; const costs = []; let oldest = null;
  for (const f of files) {
    for (const m of readJsonl(f)) {
      const ts = m.timestamp ?? m.ts ?? null;
      if (ts && (!oldest || ts < oldest)) oldest = ts;
      if (m.type === 'cost-state' || (m.totalCostUSD !== undefined && m.modelUsage)) { costs.push({ totalCostUSD: num(m.totalCostUSD), modelUsage: m.modelUsage ?? {}, startTime: m.startTime ?? null }); continue; }
      const u = usageOf(m);
      if (u && (m.type === 'assistant' || m.message?.role === 'assistant')) {
        const key = m.requestId ?? (m.message?.id ? `mid:${m.message.id}` : `line:${f}:${req.size}`);
        const prev = req.get(key);
        const merged = prev ? Object.fromEntries(Object.keys(u).map((k) => [k, Math.max(prev[k], u[k])])) : u;
        req.set(key, { ...merged, ts: ts ?? prev?.ts ?? null, model: m.message?.model ?? prev?.model ?? null });
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
  const key = (l) => `${l.skill}|${l.phase}`;
  for (const l of lines) {
    const short = String(l.skill ?? '?').replace(/^stardust:/, '');
    if (l.event === 'start') {
      if (short === 'rollout') for (const [k, w] of open) if (k.startsWith('stardust:rollout|') && !w.to) { w.to = l.ts; open.delete(k); }
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
const { main, sub } = transcriptFiles(tDir);
if (!main.length && !sub.length) unknown(`no *.jsonl under ${tDir}`);
const M = readTranscripts(main); const S = readTranscripts(sub);
const allTs = [...M.requests, ...S.requests].map((r) => r.ts).filter(Boolean).sort();
for (const w of windows) if (!w.to) w.to = allTs.at(-1) ?? w.from;
const inWin = (ts, w) => ts && ts >= w.from && ts <= w.to;
const prices = opt('prices') ? opt('prices').split(',').map(Number) : null;
const zero = () => ({ turns: 0, prompts: 0, acks: 0, fresh: 0, cacheWrite: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0, thinking: 0, subRequests: 0, subRead: 0, subOut: 0 });
const rows = windows.map((w) => ({ ...w, ...zero() }));
const unw = { label: 'unwindowed', from: null, to: null, detail: null, ...zero() };
const place = (ts) => rows.find((w) => inWin(ts, w)) ?? unw;
for (const r of M.requests) { const w = place(r.ts); w.turns += 1; for (const k of ['fresh', 'cacheWrite', 'cacheWrite1h', 'cacheWrite5m', 'cacheRead', 'output', 'thinking']) w[k] += r[k]; }
for (const r of S.requests) { const w = place(r.ts); w.subRequests += 1; w.subRead += r.cacheRead + r.fresh + r.cacheWrite; w.subOut += r.output; }
for (const p of M.prompts) { const w = place(p.ts); w.prompts += 1; if (p.ack) w.acks += 1; }
const cost = (w) => (prices ? ((w.fresh * prices[0] + w.cacheWrite * prices[1] + w.cacheRead * prices[2] + w.output * prices[3]) / 1e6) : null);
const finish = (w) => {
  const pages = w.detail?.match(/(\d+)\s*(?:\/\s*\d+\s*)?(pages|documents|urls)/i);
  const total = w.fresh + w.cacheWrite + w.cacheRead + w.output;
  const wallMin = w.from && w.to ? Math.round((Date.parse(w.to) - Date.parse(w.from)) / 60_000) : null;
  return { ...w, pages: pages ? Number(pages[1]) : null, tokensPerPage: pages && Number(pages[1]) && total ? Math.round(total / Number(pages[1])) : null, secondsPerPage: pages && Number(pages[1]) && wallMin !== null ? Math.round((wallMin * 60) / Number(pages[1])) : null, wallMin, estCost: cost(w) };
};
const table = [...rows.map(finish), finish(unw)];
const total = table.reduce((a, w) => { for (const k of Object.keys(zero())) a[k] += w[k]; return a; }, zero());
total.estCost = cost(total);
const harnessCost = [...M.costs, ...S.costs].length ? { totalCostUSD: [...M.costs, ...S.costs].reduce((a, c) => a + c.totalCostUSD, 0), sessions: M.costs.length, models: Object.fromEntries([...M.costs, ...S.costs].flatMap((c) => Object.entries(c.modelUsage)).map(([k, v]) => [k, num(v?.costUSD)])) } : null;
const firstStatus = statusLines[0]?.ts ?? null;
const oldest = [M.oldest, S.oldest].filter(Boolean).sort()[0] ?? null;
const retention = firstStatus && oldest && Date.parse(oldest) - Date.parse(firstStatus) > 3_600_000 ? `transcripts start ${oldest}, over an hour after the project's first status line ${firstStatus} — earlier windows are unrecoverable; keep the harness's transcript retention above the run's span (Claude Code: cleanupPeriodDays in settings.json, an owner setting)` : null;

// --- render ---------------------------------------------------------------------
const now = new Date().toISOString();
const fmt = (n) => (n === null || n === undefined ? '—' : typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n));
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));
const md = [];
md.push('<!-- stardust:provenance', '  writtenBy: stardust:stardust token-ledger.mjs', `  writtenAt: ${now}`, `  readArtifacts:`, `    - stardust/status.jsonl`, `    - ${tDir}`, '  synthesizedInputs: []', '-->', '', `# Usage — ${basename(root)}`, '');
md.push(`Advisory ledger from the harness transcripts (${main.length} main, ${sub.length} subagent); requests de-duplicated by requestId; windows from \`status.jsonl\`. Tokens are counts, not verdicts.`, '');
const head = ['window', 'from', 'to', 'wall min', 'turns', 'prompts', 'acks', 'fresh', 'cache write (1h / 5m)', 'cache read', 'output (thinking)', 'sub req / read / out', 'pages', 'tokens/page', ...(prices ? ['est. USD'] : [])];
md.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
const line = (w) => `| ${[w.label, w.from ?? '—', w.to ?? '—', fmt(w.wallMin), w.turns, w.prompts, w.acks, k(w.fresh), `${k(w.cacheWrite)} (${k(w.cacheWrite1h)} / ${k(w.cacheWrite5m)})`, k(w.cacheRead), `${k(w.output)} (${k(w.thinking)})`, `${w.subRequests} / ${k(w.subRead)} / ${k(w.subOut)}`, fmt(w.pages), fmt(w.tokensPerPage), ...(prices ? [fmt(w.estCost)] : [])].join(' | ')} |`;
for (const w of table) md.push(line(w));
md.push(line({ ...total, label: '**total**', from: table[0]?.from ?? null, to: table.at(-2)?.to ?? null, wallMin: null, pages: null, tokensPerPage: null }));
md.push('');
if (harnessCost) md.push(`Harness-reported session cost (not per phase): USD ${harnessCost.totalCostUSD.toFixed(2)} over ${harnessCost.sessions} session line(s)${Object.keys(harnessCost.models).length ? ` — ${Object.entries(harnessCost.models).map(([m, c]) => `${m} ${c.toFixed(2)}`).join(', ')}` : ''}.`, '');
if (retention) md.push(`Retention: ${retention}`, '');
const json = { _provenance: { writtenBy: 'stardust:stardust token-ledger.mjs', writtenAt: now }, generatedAt: now, source: { harness: opt('transcripts') ? 'transcripts-dir' : 'claude-code', dir: tDir, main: main.length, sub: sub.length }, windows: table, total, harnessCost, retention, prices };

if (!flag('dry-run')) {
  mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'usage.md'), `${md.join('\n')}\n`);
  writeFileSync(join(sd, 'usage.json'), `${JSON.stringify(json, null, 2)}\n`);
}
if (flag('json')) console.log(JSON.stringify(json, null, 2));
else {
  console.log(`usage: ${table.length - 1} window(s) + unwindowed · ${total.turns} requests (${total.subRequests} subagent) · fresh ${k(total.fresh)} · cache write ${k(total.cacheWrite)} · cache read ${k(total.cacheRead)} · output ${k(total.output)}${prices ? ` · est. USD ${total.estCost.toFixed(2)}` : ''}${harnessCost ? ` · harness-reported USD ${harnessCost.totalCostUSD.toFixed(2)} (session, not per phase)` : ''} → ${flag('dry-run') ? '(dry run)' : join(sd, 'usage.md')}`);
  if (retention) console.log(`usage: ${retention}`);
}
process.exit(0);
