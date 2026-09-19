#!/usr/bin/env node
// Guard: the permissions-snippet generator runs and every shape it or the
// harness-permissions card names resolves to a shipped script.
//
// Why: the pre-approval allowlist is only useful while its rules name scripts
// that exist. Scripts move between skills and get renamed; a stale fixed
// shape or a card example pointing at a gone file silently stops matching and
// the run is back to denial-by-denial. Both the generator's fixed shapes and
// the card's literal paths are checked against skills/<skill>/scripts/.
//
// Checks:
//   node skills/stardust/scripts/permissions-snippet.mjs --help exits 0
//   generate() returns { permissions: { allow: [non-empty] } }, JSON-serialisable
//   every `skills/<skill>/scripts/<file>` in the output exists
//   every FIXED_SHAPES[].ships exists
//   every `stardust/scripts/<skill>/<file>` or `skills/<skill>/scripts/<file>`
//     literal in reference/harness-permissions.md maps to an existing plugin file
//
// Usage: node plugins/stardust/evals/lint/permissions-shapes.mjs  (exit 1 on findings)
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generate, FIXED_SHAPES, PLUGIN_ROOT } from '../../skills/stardust/scripts/permissions-snippet.mjs';

const SCRIPT = join(PLUGIN_ROOT, 'skills', 'stardust', 'scripts', 'permissions-snippet.mjs');
const CARD = join(PLUGIN_ROOT, 'skills', 'stardust', 'reference', 'harness-permissions.md');
const findings = [];
const show = (p) => relative(process.cwd(), p);

const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
if (help.status !== 0) findings.push(`${show(SCRIPT)} --help exited ${help.status}: ${help.stderr.trim()}`);

let allow = [];
try {
  const out = JSON.parse(JSON.stringify(generate({ pluginDir: '<plugin>' })));
  allow = out?.permissions?.allow;
  if (!Array.isArray(allow) || !allow.length) findings.push(`${show(SCRIPT)}: generate() returned no permissions.allow entries`);
} catch (e) { findings.push(`${show(SCRIPT)}: generate() threw: ${e.message}`); }

const PLUGIN_PATH = /skills\/([a-z][a-z0-9-]*)\/scripts\/([A-Za-z0-9_./-]+\.(?:mjs|js|sh|py))/g;
const PROJECT_COPY = /stardust\/scripts\/([a-z][a-z0-9-]*)\/([A-Za-z0-9_./-]+\.(?:mjs|js|sh|py))/g;
let checked = 0;
const assertShips = (skill, file, where) => {
  checked += 1;
  const rel = join('skills', skill, 'scripts', file);
  if (!existsSync(join(PLUGIN_ROOT, rel))) findings.push(`${where}: ${rel} does not exist`);
};
for (const rule of allow || []) for (const m of rule.matchAll(PLUGIN_PATH)) assertShips(m[1], m[2], `generator output ${rule}`);
for (const { rule, ships } of FIXED_SHAPES) if (ships && !existsSync(join(PLUGIN_ROOT, ships))) { checked += 1; findings.push(`FIXED_SHAPES ${rule}: ${ships} does not exist`); }

readFileSync(CARD, 'utf8').split('\n').forEach((line, i) => {
  for (const m of line.matchAll(PLUGIN_PATH)) assertShips(m[1], m[2], `${show(CARD)}:${i + 1}`);
  for (const m of line.matchAll(PROJECT_COPY)) assertShips(m[1], m[2], `${show(CARD)}:${i + 1}`);
});

if (findings.length) { console.error(`permissions-shapes lint: ${findings.length} finding(s)\n` + findings.join('\n')); process.exit(1); }
console.log(`permissions-shapes lint: ${allow.length} rules generated, ${checked} shapes resolve`);
