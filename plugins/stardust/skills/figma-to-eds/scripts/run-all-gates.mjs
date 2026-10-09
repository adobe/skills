#!/usr/bin/env node
// Full gate-suite sweep — runs every module's geometry spec and every
// recorded pixel gate (verdicts carry page/selector/width/crop/threshold),
// and prints a summary table. The regression instrument for shared-layer
// changes: run before and after, diff the summaries.
//
// Usage: node run-all-gates.mjs --gates <gates/components dir> [--only <slug-substr>] [--out <summary.json>]
// Run from the directory the gates were recorded in: verdicts store the
// page/figma paths as given at record time, often relative.
// Env: NODE_MODULES_DIR — node_modules containing playwright, pixelmatch, pngjs.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const gatesDir = arg('--gates'); const only = arg('--only'); const outPath = arg('--out');
if (!gatesDir) { console.error('usage: --gates <dir> [--only <substr>] [--out <json>]'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const rows = []; let fails = 0;
// A gate exits 0 (pass) or 1 (fail) after writing its report — but node also
// exits 1 on an uncaught exception, leaving the previous report on disk. So a
// run only counts when the report was rewritten; anything else is a CRASH.
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const crashed = (r, file, before) => r.error || (r.status !== 0 && r.status !== 1)
  || mtime(file) <= before;
const crashReason = (r) => {
  if (r.error) return r.error.message;
  const lines = (r.stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /\w*Error\b/.test(l)) || lines.pop() || `exit ${r.status ?? r.signal}`).slice(0, 140);
};

const findVerdicts = (dir) => {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'diagnostics') continue; // stored evidence, not gates
      out.push(...findVerdicts(p));
    } else if (e === 'verdict.json') out.push(p);
  }
  return out;
};

for (const mod of readdirSync(gatesDir).sort()) {
  const mdir = join(gatesDir, mod);
  if (!statSync(mdir).isDirectory()) continue;
  if (only && !mod.includes(only)) continue;

  const spec = join(mdir, 'geometry-spec.json');
  try { statSync(spec); } catch { continue; }
  const report = join(mdir, 'geometry-report.json');
  let before = mtime(report);
  let r = spawnSync('node', [join(here, 'geometry-gate.mjs'), '--spec', spec,
    '--out', report], { encoding: 'utf8' });
  if (crashed(r, report, before)) {
    rows.push({ module: mod, gate: 'geometry', checks: '-', result: `CRASH (${crashReason(r)})` });
    fails += 1;
  } else {
    const geo = JSON.parse(readFileSync(report, 'utf8'));
    rows.push({ module: mod, gate: 'geometry', checks: geo.checks, result: geo.pass ? 'PASS' : `FAIL(${geo.failures})` });
    if (!geo.pass) fails += 1;
  }

  for (const v of findVerdicts(mdir)) {
    const j = JSON.parse(readFileSync(v, 'utf8'));
    if (!j.page || !j.figma) continue;
    if (j.excluded || v.includes('excluded')) {
      rows.push({ module: mod, gate: `pixel:${relative(mdir, dirname(v))}`, checks: '-', result: 'EXCLUDED (documented)' });
      continue;
    }
    before = mtime(v);
    r = spawnSync('node', [join(here, 'component-diff.mjs'),
      '--figma', j.figma, '--page', j.page, '--width', String(j.designWidth),
      '--selector', j.selector, '--crop', j.crop || '0,0,0,0',
      '--out', dirname(v), '--threshold', String(j.thresholdPct)], { encoding: 'utf8' });
    const name = relative(mdir, dirname(v)) || 'default';
    if (crashed(r, v, before)) {
      rows.push({ module: mod, gate: `pixel:${name}`, checks: '-', result: `CRASH (${crashReason(r)})` });
      fails += 1;
      continue;
    }
    const nv = JSON.parse(readFileSync(v, 'utf8'));
    rows.push({ module: mod, gate: `pixel:${name}`, checks: '-', result: nv.pass ? `PASS ${nv.diffPct}%` : `FAIL ${nv.diffPct}% (@${nv.thresholdPct})` });
    if (!nv.pass) fails += 1;
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('module', 26) + pad('gate', 26) + pad('checks', 8) + 'result');
for (const r of rows) console.log(pad(r.module, 26) + pad(r.gate, 26) + pad(r.checks, 8) + r.result);
console.log(`\n${rows.length} gates, ${fails} failing`);
if (outPath) writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), rows, fails }, null, 1));
process.exit(fails ? 1 : 0);
