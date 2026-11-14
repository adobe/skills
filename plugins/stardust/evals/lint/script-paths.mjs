#!/usr/bin/env node
// Guard: every plugin-internal script or reference path a stardust skill doc
// names must exist in the plugin tree.
//
// Why: skill text drifts from the scripts it drives. Field runs (2026-08/09)
// hit the same renamed loader three releases in a row and a gate example that
// pointed at a script living in a sibling skill; each cost an agent a probe,
// a wrong conclusion ("not installed") and a re-read of the doc. Paths are
// checkable — so check them.
//
// Checked forms (plugin-internal only; impeccable's tree and project copies
// such as `stardust/scripts/…` are out of scope):
//   skills/<skill>/scripts/<file>       ../../<skill>/scripts/<file>
//   skills/<skill>/reference/<file>.md  ../<skill>/reference/<file>.md
// (a bare `reference/<file>.md` is not checked: docs use it for sibling and
// impeccable references without a skill prefix, so it cannot be resolved)
// A line containing `script-paths: ignore` is skipped (for genuinely
// hypothetical paths — say so in the line).
//
// Usage: node plugins/stardust/evals/lint/script-paths.mjs  (exit 1 on findings)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.md') && !p.endsWith('IMPROVEMENTS.md')) files.push(p); } })(ROOT);

const SKILL = '[a-z][a-z0-9-]*';
const FILE = '[A-Za-z0-9_.-]+';
const PATTERNS = [
  { re: new RegExp(`skills/(${SKILL})/scripts/(${FILE}\\.(?:mjs|js|sh|py|json))`, 'g'), to: (m) => `${m[1]}/scripts/${m[2]}` },
  { re: new RegExp(`\\.\\./\\.\\./(${SKILL})/scripts/(${FILE}\\.(?:mjs|js|sh|py|json))`, 'g'), to: (m) => `${m[1]}/scripts/${m[2]}` },
  { re: new RegExp(`skills/(${SKILL})/reference/(${FILE}\\.md)`, 'g'), to: (m) => `${m[1]}/reference/${m[2]}` },
  { re: new RegExp(`(?<![./])\\.\\./(${SKILL})/reference/(${FILE}\\.md)`, 'g'), to: (m) => `${m[1]}/reference/${m[2]}` },
];
const SKIP_SKILLS = new Set(['impeccable']);

const findings = [];
let checked = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('script-paths: ignore')) return;
    for (const { re, to } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        const rel = to(m);
        if (SKIP_SKILLS.has(rel.split('/')[0])) continue;
        checked += 1;
        if (!existsSync(join(ROOT, rel))) findings.push(`${relative(process.cwd(), f)}:${i + 1}: ${m[0]} → skills/${rel} does not exist`);
      }
    }
  });
}
const uniq = [...new Set(findings)];
if (uniq.length) { console.error(`script-paths lint: ${uniq.length} dangling reference(s) in ${files.length} files\n` + uniq.join('\n')); process.exit(1); }
console.log(`script-paths lint: ${files.length} files, ${checked} references resolve`);
