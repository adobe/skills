#!/usr/bin/env node
// evals/golden/run.mjs — drive the deterministic script chain on the committed fixtures and write a
// byte-stable snapshot. golden.test.mjs compares a fresh run with expected/ (see README.md).
//
// Chains (each from a COPY of its fixture in a scratch dir; the fixtures are never written):
//   migrate   migrate.mjs render --all on fixtures/migrate (three pages: an archetype with a hero,
//             cards and a chrome `nav` mount; a docs index with one widget mount; a directed sibling)
//             → <out>/migrate/{migrated/**, state.json, stdout.txt}
//   rollout   inventory.mjs → blocks.mjs → plan.mjs on that migrated tree, then delivery-lint.mjs
//             --json on every migrated page → <out>/rollout/{coverage/*, rollout.json, plan.json,
//             delivery-lint.json, *.stdout.txt}
//   dynamics  dynamics-plan.mjs on fixtures/dynamics/findings.json → <out>/dynamics/*
//   spec      spec-knowledge.mjs on fixtures/spec (a saved S1–S9 work tree + judgement, one widget
//             kind) → <out>/spec/knowledge/*
// Everything runs offline: no browser, no network, no node_modules.
//
// Stability (README.md § Normalisations): the clock is frozen at --now for every chain script
// (`node --require fixed-clock.cjs`, so the stamps AND the hashes over them are stable — rollout's
// sourceHash covers the migrated HTML's provenance comment); migrate's version stamp is fixed with its
// --stardust-version flag. After the run, every text file under <out> is rewritten:
//   1. any ISO-8601 timestamp `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]` naming another instant → the --now
//      value (a belt for a stamp the shim does not reach; with the shim in place this rewrites nothing);
//   2. the scratch dir's absolute path → `<work>`, the plugin root's → `<plugin>` (migrate records the
//      capture path absolute in its provenance comment);
//   3. `"stardustVersion": "<x>"` in JSON → `"stardustVersion": "<plugin-version>"` (rollout reads the
//      plugin's version from plugin.json; a release bump is not a behaviour change).
//
// Usage: node evals/golden/run.mjs --out <dir> [--now 2026-01-01T00:00:00.000Z] [--plugin <plugin root>]
// Exit 0 when every step ran (delivery-lint findings are part of the snapshot, not a failure); 1 when a
// step exits unexpectedly (its stderr is printed); 2 on usage.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = `run.mjs — golden pipeline snapshot: migrate → rollout inventory/blocks/plan/delivery-lint, dynamics-plan,
spec-knowledge on committed fixtures, normalised to byte-stable output (README.md § Normalisations).

Usage: node evals/golden/run.mjs --out <dir> [--now 2026-01-01T00:00:00.000Z] [--plugin <plugin root>]
  --out     where the snapshot is written (created; existing files inside are replaced)
  --now     the timestamp every ISO-8601 stamp in the output is rewritten to (default 2026-01-01T00:00:00.000Z)
  --plugin  the plugin root whose skills/*/scripts run (default: the one this file lives in)
Exit 0 all steps ran · 1 a step failed (stderr shown) · 2 usage.`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const flag = (name, fb) => { const i = argv.indexOf(`--${name}`); if (i === -1) return fb; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`run.mjs: --${name} needs a value\n${USAGE}`); process.exit(2); } return v; };
const OUT = flag('out', null); if (!OUT) { console.error(`run.mjs: --out is required\n${USAGE}`); process.exit(2); }
const NOW = flag('now', '2026-01-01T00:00:00.000Z');
if (Number.isNaN(Date.parse(NOW))) { console.error(`run.mjs: --now is not an ISO date: ${NOW}`); process.exit(2); }
const PLUGIN = resolve(flag('plugin', resolve(HERE, '..', '..')));
const SKILLS = join(PLUGIN, 'skills');
const FIXTURES = join(HERE, 'fixtures');
const out = resolve(OUT);
const WORK = mkdtempSync(join(tmpdir(), 'stardust-golden-'));
const steps = [];

const script = (skill, file) => join(SKILLS, skill, 'scripts', file);
const CLOCK = join(HERE, 'fixed-clock.cjs');
/** Run one script under the frozen clock; record its exit code and stdout; fail loudly on an exit code outside `ok`. */
function run(name, skill, file, args, cwd, ok = [0]) {
  const r = spawnSync(process.execPath, ['--require', CLOCK, script(skill, file), ...args], { cwd, encoding: 'utf8', env: { ...process.env, GOLDEN_NOW: NOW } });
  steps.push({ name, script: `${skill}/${file}`, args, exit: r.status });
  if (!ok.includes(r.status)) { console.error(`run.mjs: ${name} (${skill}/${file}) exited ${r.status}\n${r.stderr}`); rmSync(WORK, { recursive: true, force: true }); process.exit(1); }
  return r;
}
const put = (rel, text) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const copy = (src, rel) => { if (existsSync(src)) cpSync(src, join(out, rel), { recursive: true }); };
const walk = (dir, acc = []) => { for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); } return acc; };

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

// ---- migrate -------------------------------------------------------------------------------------
const mproj = join(WORK, 'migrate'); cpSync(join(FIXTURES, 'migrate'), mproj, { recursive: true });
const m = run('migrate render', 'migrate', 'migrate.mjs', ['render', '--all', '--stardust-version', 'golden'], mproj);
put('migrate/stdout.txt', m.stdout);
copy(join(mproj, 'stardust', 'migrated'), 'migrate/migrated');
copy(join(mproj, 'stardust', 'state.json'), 'migrate/state.json');

// ---- rollout (same scratch project: the migrated tree is its input) -------------------------------
const ROLL = 'stardust/rollout';
const inv = run('rollout inventory', 'rollout', 'inventory.mjs', ['--migrated', 'stardust/migrated', '--out', ROLL, '--site-url', 'https://www.example.com'], mproj);
const blk = run('rollout blocks', 'rollout', 'blocks.mjs', ['--out', ROLL], mproj);
const pln = run('rollout plan', 'rollout', 'plan.mjs', ['--out', ROLL], mproj);
put('rollout/inventory.stdout.txt', inv.stdout); put('rollout/blocks.stdout.txt', blk.stdout); put('rollout/plan.stdout.txt', pln.stdout);
copy(join(mproj, ROLL), 'rollout');
// delivery-lint: one JSON document per migrated page, keyed by its served path (index.html → /dir/, leaf → /dir/leaf)
const lint = {};
const migratedDir = join(mproj, 'stardust', 'migrated');
for (const f of walk(migratedDir).filter((p) => p.endsWith('.html') && !relative(migratedDir, p).startsWith('assets/'))) {
  const rel = relative(migratedDir, f).split('\\').join('/');
  const served = basename(rel) === 'index.html' ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel.replace(/\.html$/, '')}`;
  const r = run(`delivery-lint ${served}`, 'rollout', 'delivery-lint.mjs', ['--file', `stardust/migrated/${rel}`, '--path', served, '--content', 'stardust/migrated', '--json'], mproj, [0, 1]);
  lint[served] = { exit: r.status, ...JSON.parse(r.stdout) };
}
put('rollout/delivery-lint.json', `${JSON.stringify(lint, null, 2)}\n`);

// ---- dynamics ------------------------------------------------------------------------------------
const dproj = join(WORK, 'dynamics'); mkdirSync(dproj); cpSync(join(FIXTURES, 'dynamics', 'findings.json'), join(dproj, 'findings.json'));
const dyn = run('dynamics-plan', 'dynamics', 'dynamics-plan.mjs', ['--in', 'findings.json', '--out', 'plan'], dproj);
put('dynamics/stdout.txt', dyn.stdout);
for (const f of walk(join(dproj, 'plan'))) cpSync(f, join(out, 'dynamics', basename(f)));

// ---- spec ------------------------------------------------------------------------------------------
const sproj = join(WORK, 'spec'); cpSync(join(FIXTURES, 'spec'), sproj, { recursive: true });
const spec = run('spec-knowledge', 'spec', 'spec-knowledge.mjs', ['--config', 'stardust/spec/spec.config.json'], sproj);
put('spec/stdout.txt', spec.stdout);
copy(join(sproj, 'stardust', 'spec', 'knowledge'), 'spec/knowledge');

// ---- step log + normalisation -----------------------------------------------------------------------
put('run.json', `${JSON.stringify({ now: NOW, steps }, null, 2)}\n`);
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;
const TEXT = /\.(json|jsonl|md|html|css|txt|yaml|yml|js|mjs)$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let normalised = 0; let stamps = 0;
for (const f of walk(out)) {
  if (!TEXT.test(f)) continue;
  const before = readFileSync(f, 'utf8');
  const after = before
    .replace(ISO, (m) => { if (Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(m) ? m : `${m}Z`) === Date.parse(NOW)) return m; stamps += 1; return NOW; })
    .replace(new RegExp(escapeRe(WORK), 'g'), '<work>')
    .replace(new RegExp(escapeRe(PLUGIN), 'g'), '<plugin>')
    .replace(/("stardustVersion":\s*")[^"]*(")/g, '$1<plugin-version>$2');
  if (after !== before) { writeFileSync(f, after); normalised += 1; }
}
rmSync(WORK, { recursive: true, force: true });
const files = walk(out);
console.log(`golden: ${steps.length} steps, ${files.length} files → ${relative(process.cwd(), out) || '.'} (${normalised} files normalised, ${stamps} stamps the clock shim missed; now=${NOW})`);
