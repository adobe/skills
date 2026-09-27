#!/usr/bin/env node
// evals/jev-batteries/replay.mjs — replay a harvested decision set through the decision layer (#126)
// and report agreement with the recorded answers, per battery, per question and per confidence bin,
// plus how the route would have dispatched them (act / review / escalate); the saved JSON carries one
// record per judged question (ref, expected, chosen, confidence, route) for inspection. Every request is cached
// under data/cache/ so a re-run with new thresholds costs nothing; a second --models entry adds a
// column (e.g. jev-preview) for the same items.
//
//   node replay.mjs [--items data/items.jsonl] [--models jev-1.13.0[,jev-preview]] [--battery <name>]
//                   [--limit <n>] [--concurrency 6] [--out data/replay-<timestamp>.json]
//                   [--key-env TYPESAFE_API_KEY] [--batteries <dir>]
//   node replay.mjs --help
//
// Agreement: choice → chosen option equals expected; score → rounded level equals expected; a noul is
// compared when the item's expected carries a boolean. Only questions present in `expected` count.
// Exit codes: 0 ok · 2 usage · 3 no key · 4 API failure.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, decide, loadBattery, DEFAULTS } from '../../skills/stardust/scripts/decide.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const HERE = dirname(fileURLToPath(import.meta.url));
const opt = { items: join(HERE, 'data', 'items.jsonl'), models: [DEFAULTS.model], battery: null, limit: Infinity, concurrency: 6, out: join(HERE, 'data', `replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), keyEnv: DEFAULTS.keyEnv, batteries: DEFAULTS.batteriesDir };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]; const v = () => { const x = argv[++i]; if (x === undefined || x.startsWith('--')) { console.error(`${a} needs a value`); process.exit(2); } return x; };
  if (a === '--items') opt.items = resolve(v());
  else if (a === '--models') opt.models = v().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--battery') opt.battery = v();
  else if (a === '--limit') opt.limit = Number(v());
  else if (a === '--concurrency') opt.concurrency = Number(v());
  else if (a === '--out') opt.out = resolve(v());
  else if (a === '--key-env') opt.keyEnv = v();
  else if (a === '--batteries') opt.batteries = resolve(v());
  else { console.error(`unknown flag ${a}`); process.exit(2); }
}
if (!existsSync(opt.items)) { console.error(`items not found: ${opt.items} (run harvest.mjs first)`); process.exit(2); }
const key = process.env[opt.keyEnv];
if (!key) { console.error(`replay: no key in $${opt.keyEnv}`); process.exit(3); }

let items = readFileSync(opt.items, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (opt.battery) items = items.filter((it) => it.battery === opt.battery);
const perBattery = {};
items = items.filter((it) => { perBattery[it.battery] = (perBattery[it.battery] || 0) + 1; return perBattery[it.battery] <= opt.limit; });

const cacheDir = join(HERE, 'data', 'cache');
const batteries = new Map();
const battery = (name) => { if (!batteries.has(name)) batteries.set(name, loadBattery(name, opt.batteries)); return batteries.get(name); };
const client = createClient({ key, concurrency: opt.concurrency });

const BINS = [['≥0.9', 0.9, 1.01], ['0.7–0.9', 0.7, 0.9], ['0.5–0.7', 0.5, 0.7], ['<0.5', -1, 0.5]];
const bin = (c) => (BINS.find(([, lo, hi]) => c >= lo && c < hi) || BINS[3])[0];

const results = {};
const errors = [];
const records = [];
const latencies = [];
let done = 0; let usage = { input_tokens: 0, output_tokens: 0 }; let ms = 0;
await Promise.all(items.map(async (it) => {
  for (const model of opt.models) {
    let r;
    try { r = await decide({ battery: battery(it.battery), state: it.state, client, model, cacheDir, ledger: null, ref: it.ref }); } catch (e) { errors.push({ ref: it.ref, model, error: e.message }); continue; }
    if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; }
    if (!r.cached && r.ms) { ms += r.ms; latencies.push(r.ms); }
    const R = (results[model] ||= {}); const B = (R[it.battery] ||= { n: 0, questions: {}, route: { act: 0, review: 0, escalate: 0 }, agreeWhenAct: { n: 0, ok: 0 } });
    B.n += 1; B.route[r.route.overall] += 1;
    let allOk = true; let any = false;
    for (const [q, expected] of Object.entries(it.expected)) {
      const a = r.answers[q]; if (!a) continue;
      let chosen; if (a.type === 'choice') chosen = a.choice; else if (a.type === 'score') chosen = Math.round(a.score); else chosen = a.noul >= 0.5;
      const ok = String(chosen) === String(expected);
      const conf = a.type === 'noul' ? Math.abs(a.noul - 0.5) * 2 : (a.confidence ?? 0);
      const Q = (B.questions[q] ||= { n: 0, ok: 0, bins: Object.fromEntries(BINS.map(([b]) => [b, { n: 0, ok: 0 }])), confusion: {} });
      Q.n += 1; Q.ok += ok ? 1 : 0; Q.bins[bin(conf)].n += 1; Q.bins[bin(conf)].ok += ok ? 1 : 0;
      const cell = `${expected}→${chosen}`; if (!ok) Q.confusion[cell] = (Q.confusion[cell] || 0) + 1;
      records.push({ ref: it.ref, model, battery: it.battery, question: q, expected, chosen, ok, confidence: Math.round(conf * 100) / 100, route: r.route.questions[q]?.verdict ?? null });
      any = true; allOk = allOk && ok;
    }
    if (any && r.route.overall === 'act') { B.agreeWhenAct.n += 1; B.agreeWhenAct.ok += allOk ? 1 : 0; }
  }
  done += 1;
  if (done % 25 === 0) process.stderr.write(`  ${done}/${items.length}\r`);
}));

const pct = (ok, n) => (n ? `${Math.round((ok / n) * 1000) / 10}%` : '—');
const lines = [];
for (const [model, R] of Object.entries(results)) {
  lines.push(`\n## ${model}`);
  for (const [b, B] of Object.entries(R)) {
    lines.push(`\n### ${b} — ${B.n} item(s); route act ${B.route.act} / review ${B.route.review} / escalate ${B.route.escalate}; agreement when routed act ${pct(B.agreeWhenAct.ok, B.agreeWhenAct.n)} (n=${B.agreeWhenAct.n})`);
    lines.push('| question | n | agreement | ≥0.9 | 0.7–0.9 | 0.5–0.7 | <0.5 | top confusions |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const [q, Q] of Object.entries(B.questions)) {
      const bins = BINS.map(([name]) => `${pct(Q.bins[name].ok, Q.bins[name].n)} (${Q.bins[name].n})`).join(' | ');
      const conf = Object.entries(Q.confusion).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ×${v}`).join(', ');
      lines.push(`| ${q} | ${Q.n} | ${pct(Q.ok, Q.n)} | ${bins} | ${conf} |`);
    }
  }
}
const sorted = [...latencies].sort((a, b) => a - b); const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
lines.push(`\nTokens: ${usage.input_tokens} in / ${usage.output_tokens} out (≈ $${((usage.input_tokens / 1e6) * 0.042).toFixed(4)} at $0.042 per M input); ${latencies.length} uncached request(s), latency median ${med} ms / p95 ${p95} ms; errors ${errors.length}.`);
if (errors.length) lines.push(errors.slice(0, 5).map((e) => `  ${e.ref} [${e.model}]: ${e.error}`).join('\n'));
console.log(lines.join('\n'));
mkdirSync(dirname(opt.out), { recursive: true });
writeFileSync(opt.out, JSON.stringify({ at: new Date().toISOString(), items: items.length, models: opt.models, results, usage, latency: { median: med, p95, n: latencies.length }, errors, records }, null, 2));
console.log(`\nsaved ${opt.out}`);
process.exit(errors.length && errors.length === items.length * opt.models.length ? 4 : 0);
