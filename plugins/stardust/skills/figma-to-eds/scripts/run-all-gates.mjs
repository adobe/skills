#!/usr/bin/env node
// Full gate-suite sweep — runs every module's geometry spec and every
// recorded pixel gate (verdicts carry page/selector/width/crop/threshold),
// and prints a summary table. The regression instrument for shared-layer
// changes: run before and after, diff the summaries.
//
// Usage: node run-all-gates.mjs --gates <gates/components dir> [--only <slug-substr>] [--out <summary.json>]
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
  let r = spawnSync('node', [join(here, 'geometry-gate.mjs'), '--spec', spec,
    '--out', join(mdir, 'geometry-report.json')], { encoding: 'utf8' });
  const geo = JSON.parse(readFileSync(join(mdir, 'geometry-report.json'), 'utf8'));
  rows.push({ module: mod, gate: 'geometry', checks: geo.checks, result: geo.pass ? 'PASS' : `FAIL(${geo.failures})` });
  if (!geo.pass) fails += 1;

  for (const v of findVerdicts(mdir)) {
    const j = JSON.parse(readFileSync(v, 'utf8'));
    if (!j.page || !j.figma) continue;
    if (j.excluded || v.includes('excluded')) {
      rows.push({ module: mod, gate: `pixel:${relative(mdir, dirname(v))}`, checks: '-', result: 'EXCLUDED (documented)' });
      continue;
    }
    r = spawnSync('node', [join(here, 'component-diff.mjs'),
      '--figma', j.figma, '--page', j.page, '--width', String(j.designWidth),
      '--selector', j.selector, '--crop', j.crop || '0,0,0,0',
      '--out', dirname(v), '--threshold', String(j.thresholdPct)], { encoding: 'utf8' });
    const nv = JSON.parse(readFileSync(v, 'utf8'));
    const name = relative(mdir, dirname(v)) || 'default';
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
