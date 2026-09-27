#!/usr/bin/env node
// evals/jev-batteries/collect-ab.mjs — fill the A/B report (AB-TEMPLATE.md) from two finished runs (#127):
// the `off` arm and the `assist` arm of the same site. Reads each project's ledgers and, when given, its
// Claude Code transcript folder, and prints the KPI table plus the findings the template asks for.
//
//   node collect-ab.mjs --off <project dir> --assist <project dir>
//                       [--off-transcripts <dir>] [--assist-transcripts <dir>] [--width 1440]
//                       [--price-out 50 --price-read 0.25 --price-write 12.5]   (USD per M tokens)
//                       [--out data/AB-<role>-<date>.md] [--json]
//
// Per arm: wall-clock (status.jsonl first→last ts), phases and blocked lines, pages within the full bar
// at the published origin and pixel-only passes (replica/gates/all-<w>/summary.json), gate rounds per
// archetype and residuals with a cause (replica/progress.json), flags decisive / unsure per round
// (replica/gates/*/flags-*.json), decisions and agreement per battery (decisions.jsonl via decide.mjs),
// supervisor REVIEW lines and refusals (decisions.jsonl phase-claim), and — with a transcript dir —
// assistant turns, tool calls, output / cache-read / cache-write tokens and the API-equivalent cost.
// Exit codes: 0 · 2 usage.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const val = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const opt = { off: val('--off'), assist: val('--assist'), offT: val('--off-transcripts'), assistT: val('--assist-transcripts'), width: Number(val('--width', 1440)), price: { out: Number(val('--price-out', 50)), read: Number(val('--price-read', 0.25)), write: Number(val('--price-write', 12.5)) }, out: val('--out'), json: argv.includes('--json') };
if (!opt.off || !opt.assist) { console.error('collect-ab: --off <dir> and --assist <dir> are required'); process.exit(2); }
const readJSON = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

export function collectArm(project, transcripts, width) {
  const sd = join(resolve(project), 'stardust'); const arm = {};
  const status = jsonl(join(sd, 'status.jsonl'));
  if (status.length) { const ts = status.map((l) => l.ts).filter(Boolean).sort(); arm.wallClockMin = Math.round((new Date(ts.at(-1)) - new Date(ts[0])) / 60000); arm.phases = status.filter((l) => l.event === 'end').length; arm.blocked = status.filter((l) => l.event === 'blocked').length; }
  const st = readJSON(join(sd, 'state.json')) || {}; const pages = Array.isArray(st.pages) ? st.pages : Object.values(st.pages || {}); arm.pages = pages.length; arm.decider = st.decider || 'unset'; arm.flow = st.flow || null;
  const table = readJSON(join(sd, 'replica', 'gates', `all-${width}`, 'summary.json'));
  if (table && Array.isArray(table.rows)) { arm.tableRows = table.rows.length; arm.fullPass = table.rows.filter((r) => r.pass).length; arm.pixelOnlyPass = table.rows.filter((r) => r.pixelOnlyPass ?? r.pass).length; }
  const prog = readJSON(join(sd, 'replica', 'progress.json')) || {}; const cells = []; const residuals = [];
  (function walk(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(walk); return; } if (o.iterations != null && o.result) cells.push({ iterations: o.iterations, pass: !!o.result.pass, pct: o.result.pixelPct }); if (Array.isArray(o.residuals)) for (const r of o.residuals) residuals.push({ cause: !!r.cause }); for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v); })(prog);
  if (cells.length) { arm.gateCells = cells.length; arm.meanIterations = Math.round((cells.reduce((s, c) => s + c.iterations, 0) / cells.length) * 100) / 100; arm.cellsOverCap = cells.filter((c) => c.iterations > 3).length; arm.cellsPass = cells.filter((c) => c.pass).length; }
  arm.residuals = residuals.length; arm.residualsWithCause = residuals.filter((r) => r.cause).length;
  // flags per round
  const gates = join(sd, 'replica', 'gates'); let flags = 0; let decisive = 0; let unsure = 0; let roundsWithFlags = 0;
  if (existsSync(gates)) for (const g of readdirSync(gates)) { const gd = join(gates, g); if (!statSync(gd).isDirectory()) continue; for (const f of readdirSync(gd).filter((x) => /^flags-.*\.json$/.test(x))) { const j = readJSON(join(gd, f)); if (!j || !Array.isArray(j.flags)) continue; roundsWithFlags += 1; for (const fl of j.flags) { flags += 1; if (fl.defect >= (j.thresholds?.defect ?? 0.85) || fl.defect <= (j.thresholds?.notDefect ?? 0.15)) decisive += 1; else unsure += 1; } } }
  arm.flags = { rounds: roundsWithFlags, flags, decisive, unsure };
  // decisions
  const dec = jsonl(join(sd, 'decisions.jsonl'));
  if (dec.length) {
    arm.decisions = dec.length; arm.jevTokens = dec.reduce((s, l) => s + ((l.usage && l.usage.input_tokens) || 0), 0); arm.jevCostUsd = Math.round(arm.jevTokens / 1e6 * 0.042 * 10000) / 10000;
    const lat = dec.filter((l) => !l.cached && l.ms).map((l) => l.ms).sort((a, b) => a - b); arm.jevMedianMs = lat.length ? lat[Math.floor(lat.length / 2)] : null;
    const perB = {}; for (const l of dec) { const B = (perB[l.battery] ||= { n: 0, withAgent: 0, agree: 0, act: 0, actAgree: 0, review: 0 }); B.n += 1; if (l.route && l.route.overall) B[l.route.overall] = (B[l.route.overall] || 0) + 1; if (l.agreement) { const vals = Object.values(l.agreement).filter((v) => v !== null); if (vals.length) { B.withAgent += 1; const ok = vals.every(Boolean); if (ok) B.agree += 1; if (l.route && l.route.overall === 'act') { B.actAgree += ok ? 1 : 0; } } } if (l.shadow && l.shadow.review) B.review += 1; }
    arm.batteries = perB;
    const pc = dec.filter((l) => l.battery === 'phase-claim'); arm.phaseClaims = pc.length; arm.phaseClaimReviews = pc.filter((l) => { const a = l.answers || {}; const bar = 0.85; return (a.asserts_without_evidence && a.asserts_without_evidence.noul >= bar) || (a.declares_skip_or_deferral && a.declares_skip_or_deferral.noul >= bar); }).length;
  }
  // transcripts
  if (transcripts && existsSync(transcripts)) {
    let turns = 0; let tools = 0; let out = 0; let read = 0; let write = 0; let tmin = null; let tmax = null;
    const files = []; (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.jsonl')) files.push(p); } })(transcripts);
    for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) { if (!line.includes('"assistant"')) continue; let j; try { j = JSON.parse(line); } catch { continue; } if (j.type !== 'assistant' || !j.message || !j.message.usage) continue; const u = j.message.usage; turns += 1; out += u.output_tokens || 0; read += u.cache_read_input_tokens || 0; write += u.cache_creation_input_tokens || 0; for (const c of j.message.content || []) if (c && c.type === 'tool_use') tools += 1; if (j.timestamp) { tmin = !tmin || j.timestamp < tmin ? j.timestamp : tmin; tmax = !tmax || j.timestamp > tmax ? j.timestamp : tmax; } }
    arm.turns = turns; arm.toolCalls = tools; arm.outputTokens = out; arm.cacheRead = read; arm.cacheWrite = write; arm.transcriptSpanMin = tmin && tmax ? Math.round((new Date(tmax) - new Date(tmin)) / 60000) : null;
  }
  return arm;
}

export function costUsd(arm, price) { if (arm.outputTokens == null) return null; return Math.round(((arm.outputTokens / 1e6) * price.out + (arm.cacheRead / 1e6) * price.read + (arm.cacheWrite / 1e6) * price.write) * 100) / 100; }

export function render(off, assist, price) {
  const f = (v) => (v == null ? '—' : typeof v === 'number' ? String(v) : v);
  const rows = [
    ['wall-clock, first → last ledger line (min)', off.wallClockMin, assist.wallClockMin],
    ['phases ended / blocked lines', `${f(off.phases)} / ${f(off.blocked)}`, `${f(assist.phases)} / ${f(assist.blocked)}`],
    ['pages in state.json', off.pages, assist.pages],
    ['pages within the full four-criteria bar (published origin)', off.tableRows != null ? `${off.fullPass} / ${off.tableRows}` : '—', assist.tableRows != null ? `${assist.fullPass} / ${assist.tableRows}` : '—'],
    ['pixel-only passes (calibration)', off.tableRows != null ? `${off.pixelOnlyPass} / ${off.tableRows}` : '—', assist.tableRows != null ? `${assist.pixelOnlyPass} / ${assist.tableRows}` : '—'],
    ['archetype gate cells: mean iterations · over cap · pass', off.gateCells ? `${off.meanIterations} · ${off.cellsOverCap} · ${off.cellsPass}/${off.gateCells}` : '—', assist.gateCells ? `${assist.meanIterations} · ${assist.cellsOverCap} · ${assist.cellsPass}/${assist.gateCells}` : '—'],
    ['residuals with a named cause', `${f(off.residualsWithCause)} / ${f(off.residuals)}`, `${f(assist.residualsWithCause)} / ${f(assist.residuals)}`],
    ['flags pre-sorted: rounds · flags · decisive · unsure', '—', assist.flags ? `${assist.flags.rounds} · ${assist.flags.flags} · ${assist.flags.decisive} · ${assist.flags.unsure}` : '—'],
    ['decisions logged · Jev tokens · cost · median ms', off.decisions ? `${off.decisions} · ${off.jevTokens} · $${off.jevCostUsd} · ${off.jevMedianMs}` : '—', assist.decisions ? `${assist.decisions} · ${assist.jevTokens} · $${assist.jevCostUsd} · ${assist.jevMedianMs}` : '—'],
    ['phase-claim checks · REVIEW (asserted or skipped ≥ 0.85)', '—', assist.phaseClaims != null ? `${assist.phaseClaims} · ${assist.phaseClaimReviews}` : '—'],
    ['assistant turns / tool calls', off.turns != null ? `${off.turns} / ${off.toolCalls}` : '—', assist.turns != null ? `${assist.turns} / ${assist.toolCalls}` : '—'],
    ['output / cache-read / cache-write tokens (M)', off.outputTokens != null ? `${(off.outputTokens / 1e6).toFixed(2)} / ${(off.cacheRead / 1e6).toFixed(0)} / ${(off.cacheWrite / 1e6).toFixed(1)}` : '—', assist.outputTokens != null ? `${(assist.outputTokens / 1e6).toFixed(2)} / ${(assist.cacheRead / 1e6).toFixed(0)} / ${(assist.cacheWrite / 1e6).toFixed(1)}` : '—'],
    ['API-equivalent cost (USD, list prices given)', costUsd(off, price), costUsd(assist, price)],
  ];
  const out = ['| KPI | off | assist |', '|---|---|---|', ...rows.map(([k, a, b]) => `| ${k} | ${f(a)} | ${f(b)} |`)];
  if (assist.batteries) { out.push('', '| battery (assist arm) | decisions | with agent answer | agree | act | agree when act | shadow review |', '|---|---|---|---|---|---|---|'); for (const [b, B] of Object.entries(assist.batteries)) out.push(`| ${b} | ${B.n} | ${B.withAgent} | ${B.withAgent ? Math.round(100 * B.agree / B.withAgent) + ' %' : '—'} | ${B.act || 0} | ${B.act ? Math.round(100 * B.actAgree / B.act) + ' %' : '—'} | ${B.review} |`); }
  return out.join('\n');
}

const off = collectArm(opt.off, opt.offT, opt.width); const assist = collectArm(opt.assist, opt.assistT, opt.width);
const md = render(off, assist, opt.price);
if (opt.json) console.log(JSON.stringify({ off, assist }, null, 2)); else console.log(md);
if (opt.out) { mkdirSync(dirname(resolve(opt.out)), { recursive: true }); writeFileSync(resolve(opt.out), `# A/B — collected ${new Date().toISOString().slice(0, 10)}\n\noff: \`${opt.off}\` · assist: \`${opt.assist}\`\n\n${md}\n`); console.error(`collect-ab: wrote ${opt.out}`); }
