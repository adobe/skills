#!/usr/bin/env node
/**
 * skills/replica/scripts/gate-batch.mjs — one gate sweep over many pairs, in the
 * background, with one verdict table and the batch-driver completion contract.
 *
 * Why: a sweep over several archetypes or breakpoints was a foreground `for` loop
 * of gate.sh calls polled with `sleep N; tail` (source-fidelity-gate.md § Iteration
 * discipline, "your waiting has a ceiling too"). This wrapper runs the SAME gate.sh
 * rounds under a small pool, writes ONE progress JSON while it runs and prints ONE
 * table + ONE SUMMARY line when it ends — the agent's ≤ 4-minute check is a single
 * `progress.mjs read`. Nothing about a round changes: bars, records, the cap, the
 * cached live.png per pair (each pair owns its gate dir; the same slug@width twice
 * in one file is refused). Pairs are POOLED PER LIVE HOST: rows sharing a live
 * hostname run one after another (live-budget's per-host live lock — one
 * live-hitting tool per origin at a time — would otherwise fail the second
 * capture with LiveLockError → exit 1, NO VERDICT); only rows on different hosts
 * run at once, so --concurrency caps the number of hosts hit in parallel.
 *
 * Usage:
 *   node skills/replica/scripts/gate-batch.mjs <pairs.tsv> [--concurrency 2] [--gate <gate.sh>]
 *        [--out stardust/.work/replica/gate-batch] [--progress <file> | --no-progress] [--dry-run]
 *   pairs.tsv — one pair per line, tab-separated: slug  live-url  build-url  width  [marker]
 *               (`#` lines and blank lines are skipped; a marker becomes gate.sh --marker)
 *   --concurrency  parallel gate.sh rounds, one per live host (default 2 — two Chromium
 *                  captures at a time; same-host pairs are always sequential)
 *   --gate         gate.sh to run (default: the gate.sh beside this script)
 *   --out          per-pair logs <slug>-<width>.log + gate-batch.json (the SUMMARY details)
 *   --progress     progress JSON (default stardust/.work/replica/gate-batch.progress.json)
 *   --dry-run      print the rows that would run; run nothing
 *   GATE_* environment variables pass through to every round unchanged.
 *
 * Verdicts (gate.sh exit → row): 0 PASS → ok · 2 FAIL → failed · every other code is
 * NO VERDICT → noverdict, named by code (124 deadline, 3 bot-challenge, 5 invalid-capture,
 * 6 cap-reached, 4 wrong-server, 1 error, 125 usage). A deadline is never folded into
 * failed. Table: slug width exit verdict pixel% Δh record (from gate-<label>.json when
 * the round wrote one).
 *
 * Exit: 2 when any pair FAILED · else 124 when any pair hit a deadline · else the first
 * other non-zero round code · 0 all PASS · 125 usage (bad file, bad row, duplicate pair).
 * Last stdout line: `SUMMARY gate-batch ok=<n> failed=<n> [noverdict=<n>] exit=<code>
 * details=<out>/gate-batch.json pairs=<n> concurrency=<c>`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: gate-batch.mjs <pairs.tsv> [--concurrency 2] [--gate <gate.sh>] [--out <dir>] [--progress <file> | --no-progress] [--dry-run]';
export const NO_VERDICT = { 124: 'deadline', 3: 'bot-challenge', 5: 'invalid-capture', 6: 'cap-reached', 4: 'wrong-server', 1: 'error', 125: 'usage' };

// progress.mjs: plugin tree, else the project copy beside stardust/scripts/stardust/; absent → SUMMARY only
async function loadProgress() {
  for (const c of ['../../stardust/scripts/progress.mjs', '../stardust/progress.mjs']) {
    try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  console.error('gate-batch: WARN progress.mjs not found next to this script — no progress file; copy skills/stardust/scripts/progress.mjs to stardust/scripts/stardust/');
  const summaryLine = ({ driver, ok = 0, failed = 0, noverdict = 0, exit = 0, details = '-', extra = {} }) => [`SUMMARY ${driver}`, `ok=${ok}`, `failed=${failed}`, ...(noverdict ? [`noverdict=${noverdict}`] : []), `exit=${exit}`, `details=${details}`, ...Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`)].join(' ');
  const createProgress = ({ driver, total = 0 }) => {
    const state = { driver, total, done: 0, ok: 0, failed: 0, noverdict: 0, lastPath: null };
    return { state, set() {}, tick({ ok, path: p, noverdict = false }) { state.done += 1; if (noverdict) state.noverdict += 1; else if (ok) state.ok += 1; else state.failed += 1; if (p) state.lastPath = p; }, summaryLine({ exit = 0, details = '-', extra = {} } = {}) { return summaryLine({ driver, ok: state.ok, failed: state.failed, noverdict: state.noverdict, exit, details, extra }); } };
  };
  return { createProgress, summaryLine };
}

/** Parse pairs.tsv → rows [{ slug, live, build, width, marker, line }]; throws on a bad row or a duplicate slug@width. */
export function parsePairs(text) {
  const rows = [];
  const seen = new Set();
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length < 4 || cols.slice(0, 4).some((c) => !c)) throw new Error(`line ${i + 1}: expected slug<TAB>live-url<TAB>build-url<TAB>width[<TAB>marker], got ${JSON.stringify(line)}`);
    const [slug, live, build, w, marker] = cols;
    const width = Number(w);
    if (!Number.isInteger(width) || width <= 0) throw new Error(`line ${i + 1}: width must be a positive integer, got ${JSON.stringify(w)}`);
    for (const [k, u] of [['live-url', live], ['build-url', build]]) { try { new URL(u); } catch { throw new Error(`line ${i + 1}: ${k} is not a URL: ${u}`); } }
    const key = `${slug}-${width}`;
    if (seen.has(key)) throw new Error(`line ${i + 1}: ${slug}@${width} appears twice — one gate dir per pair, one live capture per pair`);
    seen.add(key);
    rows.push({ slug, live, build, width, marker: marker || null, line: i + 1 });
  });
  return rows;
}

/** Row verdict from gate.sh's exit code. */
export function classify(code) {
  if (code === 0) return { verdict: 'PASS', ok: true, noverdict: false };
  if (code === 2) return { verdict: 'FAIL', ok: false, noverdict: false };
  return { verdict: `NO VERDICT (${NO_VERDICT[code] || `exit ${code}`})`, ok: false, noverdict: true };
}

/** Batch exit: 2 any FAIL · 124 any deadline · first other non-zero · 0. */
export function batchExit(codes) {
  if (codes.includes(2)) return 2;
  if (codes.includes(124)) return 124;
  return codes.find((c) => c !== 0) ?? 0;
}

function parseArgs(argv) {
  const a = { concurrency: 2, gate: path.join(HERE, 'gate.sh'), out: path.join('stardust', '.work', 'replica', 'gate-batch'), dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') { a.help = true; return a; }
    if (k === '--concurrency') { a.concurrency = Number(argv[(i += 1)]); if (!Number.isInteger(a.concurrency) || a.concurrency < 1) throw new Error('--concurrency must be a positive integer'); }
    else if (k === '--gate') a.gate = argv[(i += 1)];
    else if (k === '--out') a.out = argv[(i += 1)];
    else if (k === '--progress') a.progress = argv[(i += 1)];
    else if (k === '--no-progress') a.progress = null;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k.startsWith('--')) throw new Error(`unknown argument ${k}`);
    else if (!a.file) a.file = k;
    else throw new Error(`unexpected argument ${k}`);
  }
  if (!a.file) throw new Error('pairs.tsv is required');
  if (a.progress === undefined) a.progress = path.join('stardust', '.work', 'replica', 'gate-batch.progress.json');
  return a;
}

function runGate(gate, row, logFile) {
  return new Promise((resolve) => {
    const args = [gate, row.slug, row.live, row.build, String(row.width)];
    if (row.marker) args.push('--marker', row.marker);
    const child = spawn('bash', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code, signal) => {
      writeFileSync(logFile, `$ bash ${args.join(' ')}\n--- stdout\n${out}\n--- stderr\n${err}\n--- exit ${code ?? `signal ${signal}`}\n`);
      const rec = [...out.matchAll(/record: (\S+)/g)].at(-1)?.[1] || null;
      let pixelPct = null; let heightDelta = null;
      if (rec && existsSync(rec)) { try { const j = JSON.parse(readFileSync(rec, 'utf8')); pixelPct = j.pixelPct ?? null; heightDelta = j.heightDelta ?? null; } catch { /* a no-verdict record may be {} */ } }
      resolve({ code: code ?? 1, record: rec, pixelPct, heightDelta, iteration: out.match(/^iteration (\d+\/3)/m)?.[1] || null });
    });
  });
}

/** Rows grouped by live hostname (input order kept inside a group and across first appearances). */
export function groupByHost(rows) {
  const byHost = new Map();
  rows.forEach((row, idx) => {
    const host = new URL(row.live).hostname.toLowerCase();
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push({ row, idx });
  });
  return [...byHost.values()];
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i; i += 1; await fn(items[idx], idx); } });
  await Promise.all(workers);
}

export function renderTable(results) {
  const rows = results.map((r) => [r.slug, String(r.width), String(r.code), r.verdict, r.pixelPct == null ? '-' : `${r.pixelPct}%`, r.heightDelta == null ? '-' : `${r.heightDelta}px`, r.iteration || '-', r.record || '-']);
  const head = ['slug', 'width', 'exit', 'verdict', 'pixel', 'Δh', 'iteration', 'record'];
  const w = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [fmt(head), fmt(w.map((n) => '-'.repeat(n))), ...rows.map(fmt)].join('\n');
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error(`gate-batch: ${e.message}\n${USAGE}`); return 125; }
  if (args.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).join('\n').split('*/')[0].split('\n').filter((l) => l !== '/**').map((l) => l.replace(/^ \* ?/, '')).join('\n').trim()); return 0; }
  if (!existsSync(args.file)) { console.error(`gate-batch: ${args.file} not found\n${USAGE}`); return 125; }
  let rows;
  try { rows = parsePairs(readFileSync(args.file, 'utf8')); } catch (e) { console.error(`gate-batch: ${args.file}: ${e.message}`); return 125; }
  if (!rows.length) { console.error(`gate-batch: ${args.file} has no pairs`); return 125; }
  if (!existsSync(args.gate)) { console.error(`gate-batch: gate.sh not found at ${args.gate} (--gate <path>)`); return 125; }
  if (args.dryRun) {
    for (const r of rows) console.log(`${r.slug}\t${r.live}\t${r.build}\t${r.width}${r.marker ? `\t--marker ${r.marker}` : ''}`);
    console.log(`gate-batch: ${rows.length} pair(s) on ${groupByHost(rows).length} live host(s), concurrency ${args.concurrency}, gate ${args.gate} (dry run — nothing ran)`);
    return 0;
  }
  mkdirSync(args.out, { recursive: true });
  const { createProgress } = await loadProgress();
  const progress = createProgress({ file: args.progress, driver: 'gate-batch', total: rows.length, extra: { concurrency: args.concurrency, gate: args.gate, out: args.out } });
  const results = new Array(rows.length);
  const groups = groupByHost(rows);
  console.error(`gate-batch: ${rows.length} pair(s) on ${groups.length} live host(s), concurrency ${args.concurrency} (same-host pairs run sequentially), logs in ${args.out}/`);
  await pool(groups, args.concurrency, async (group) => {
    for (const { row, idx } of group) {
      const key = `${row.slug}-${row.width}`;
      const r = await runGate(args.gate, row, path.join(args.out, `${key}.log`));
      const c = classify(r.code);
      results[idx] = { ...row, ...r, ...c };
      progress.tick({ ok: c.ok, noverdict: c.noverdict, path: key });
      console.error(`[${progress.state.done}/${rows.length}] ${c.verdict.padEnd(8)} ${key} (exit ${r.code})${r.pixelPct != null ? `  ${r.pixelPct}%` : ''}`);
    }
  });
  const codes = results.map((r) => r.code);
  const exit = batchExit(codes);
  const details = path.join(args.out, 'gate-batch.json');
  writeFileSync(details, `${JSON.stringify({ at: new Date().toISOString(), gate: args.gate, concurrency: args.concurrency, exit, counts: { ok: progress.state.ok, failed: progress.state.failed, noverdict: progress.state.noverdict }, pairs: results.map(({ slug, width, code, verdict, pixelPct, heightDelta, iteration, record }) => ({ slug, width, exit: code, verdict, pixelPct, heightDelta, iteration, record, log: path.join(args.out, `${slug}-${width}.log`) })) }, null, 2)}\n`);
  console.log(renderTable(results));
  console.log(progress.summaryLine({ exit, details, extra: { pairs: rows.length, concurrency: args.concurrency } }));
  return exit;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main(process.argv).then((c) => process.exit(c));
