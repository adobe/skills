#!/usr/bin/env node
// Guard: the davids-model-lint icon/variant rules keep their tiers and exit codes.
//
// Why: the gate is only worth running if a mis-authored `:icon-x:` token or a
// variant token that collides with a foundation class fails the page BEFORE
// the PUT, and a legitimate page still passes — this pins both directions and
// the flag-dependent tiers (no --icons-dir → advisory only) against the
// fixtures in fixtures/davids-model-lint/.
//
// Usage: node plugins/stardust/evals/lint/davids-model-lint-fixtures.mjs  (exit 1 on findings)
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const LINT = join(HERE, '..', '..', 'skills', 'deploy', 'scripts', 'davids-model-lint.mjs');
const FIX = join(HERE, 'fixtures', 'davids-model-lint');
const ICONS = ['--icons-dir', join(FIX, 'icons')];
const STYLES = ['--styles', join(FIX, 'styles.css')];

const CASES = [
  { name: 'icons: double prefix + missing asset fail with --icons-dir', args: ['fail-icons.html', ...ICONS, ...STYLES], exit: 2, red: ['ICON-PREFIX', 'ICON-MISSING'], yellow: [] },
  { name: 'icons: without --icons-dir the prefix is advisory only', args: ['fail-icons.html', ...STYLES], exit: 0, red: [], yellow: ['ICON-PREFIX'], absent: ['ICON-MISSING'] },
  { name: 'variants: reserved token and bare foundation selector fail', args: ['fail-variant.html', ...ICONS, ...STYLES], exit: 2, red: ['VARIANT-COLLIDE'], yellow: [], tokens: ['"icon"', '"illu"'] },
  { name: 'pass: :name: token, decorated span, compound-selector variant is advisory', args: ['pass.html', ...ICONS, ...STYLES], exit: 0, red: [], yellow: ['VARIANT-COLLIDE'], absent: ['ICON-PREFIX', 'ICON-MISSING'] },
  { name: 'tree mode: one finding per token with page count', args: ['.', ...ICONS, ...STYLES], exit: 2, oncePer: ['ICON-PREFIX'], pages: 'fail-icons.html' },
  { name: 'usage: --styles that does not exist is a usage error', args: ['pass.html', '--styles', join(FIX, 'nope.css')], exit: 1 },
];

const failures = [];
for (const c of CASES) {
  const r = spawnSync(process.execPath, [LINT, ...c.args, '--json'], { cwd: FIX, encoding: 'utf8' });
  const label = `${c.name} [${c.args.filter((a) => !a.startsWith('/')).join(' ')}]`;
  if (r.status !== c.exit) { failures.push(`${label}: exit ${r.status}, expected ${c.exit}\n${r.stderr || r.stdout}`); continue; }
  if (c.exit === 1) continue;
  let out;
  try { out = JSON.parse(r.stdout); } catch (e) { failures.push(`${label}: --json output is not JSON`); continue; }
  const rules = (sev) => out.findings.filter((f) => f.sev === sev).map((f) => f.rule);
  for (const id of c.red || []) if (!rules('🔴').includes(id)) failures.push(`${label}: expected 🔴 ${id}`);
  for (const id of c.yellow || []) if (!rules('🟡').includes(id)) failures.push(`${label}: expected 🟡 ${id}`);
  for (const id of c.absent || []) if (out.findings.some((f) => f.rule === id)) failures.push(`${label}: unexpected ${id}`);
  for (const t of c.tokens || []) if (!out.findings.some((f) => f.rule === 'VARIANT-COLLIDE' && f.msg.includes(t))) failures.push(`${label}: expected VARIANT-COLLIDE for ${t}`);
  for (const id of c.oncePer || []) {
    const hits = out.findings.filter((f) => f.rule === id);
    if (hits.length !== 1) failures.push(`${label}: ${id} reported ${hits.length}×, expected once`);
    else if (!(hits[0].pages || []).some((p) => p.endsWith(c.pages))) failures.push(`${label}: ${id} pages ${JSON.stringify(hits[0].pages)} lack ${c.pages}`);
  }
}
if (failures.length) { console.error(`davids-model-lint fixtures: ${failures.length} failure(s)\n${failures.join('\n')}`); process.exit(1); }
console.log(`davids-model-lint fixtures: ${CASES.length} cases pass (${relative(process.cwd(), FIX)})`);
