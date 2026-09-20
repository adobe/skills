#!/usr/bin/env node
/**
 * skills/stardust/scripts/preflight-runtime.mjs — the runtime preflight.
 *
 * One idempotent Setup step (master § Setup step 10; first command of every
 * delegated brief) that makes the browser instruments runnable from any
 * script location and records the environment the run saw:
 *
 *   1. `<root>/stardust/package.json` (private, devDependencies playwright /
 *      pixelmatch / pngjs) — written or merged; ONE `npm i --prefix stardust`
 *      when any of the three fails to resolve from it. Node's parent walk then
 *      resolves `stardust/node_modules` from the project script copies AND from
 *      `stardust/.work/<skill>/probes/`; the EDS repo's own `npm i` can never
 *      prune it. A package reachable only through the parent walk
 *      (`<root>/node_modules`, a past `--no-save` install) is `missing`, not
 *      `ok` — the next EDS `npm i` prunes it. `<root>/package.json` is never written.
 *   2. Chromium: the resolved Playwright's `chromium.executablePath()` exists,
 *      else `playwright install chromium` (skipped under --no-install).
 *   3. `stardust/.work/probes/` (+ README) — ad-hoc probes live here, not /tmp.
 *   4. Environment record → `<root>/stardust/.work/env.json` (merged with what
 *      is there, e.g. `transports` from preflight-transports.mjs):
 *      { projectRoot, nodeBin, nodeVersion, shell, bash32, pathSnapshot, tools,
 *        deps: { <pkg>: <version|null> }, chromium, lint, ports: {}, envFile,
 *        preflight: "ok" | "partial" | "skipped", missing: [<actionable line>], writtenAt }
 *   5. Lint: when `<root>/package.json` carries an eslint setup, `eslint` and
 *      `@babel/eslint-parser` must resolve from <root>; else `lint: "unavailable"`,
 *      one loud line and exit 1 (the EDS devDependencies are the repo's — never
 *      installed from here; the agent runs the printed `npm ci` itself).
 *
 * Usage:
 *   node skills/stardust/scripts/preflight-runtime.mjs [--root <dir>] [--no-install] [--offline] [--skip] [--json]
 *     --root <dir>   project root (default: nearest ancestor of cwd with a stardust/ dir, else cwd);
 *                    <root>/stardust/ must exist — a root without it exits 2 and writes nothing
 *     --no-install   check only — never spawn npm or the browser download and write nothing
 *                    tracked (no stardust/package.json); only .work/ is written (read-only sessions)
 *     --offline      accept a pre-populated stardust/node_modules; no network (implies --no-install)
 *     --skip         record `preflight: "skipped"` and exit 0 (the state report prints it)
 *     --json         print the env record on stdout (the `missing` lines then go to stderr)
 *
 * Exit codes: 0 every item present (or --skip) · 1 at least one item missing —
 * a dependency, chromium, or lint in a repo that declares it — one actionable
 * line per item, also kept as env.json `missing` (never a verdict: a missing
 * browser is exit 2 in the instruments, the same no-verdict class as exit 124)
 * · 2 usage / I/O error, including a --root (or cwd) with no stardust/ dir.
 * Zero requests to the source site: npm registry and the Playwright CDN only.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, delimiter, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEPS = ['playwright', 'pixelmatch', 'pngjs'];
export const TOOLS = ['node', 'npm', 'curl', 'python3', 'lsof', 'git'];
const PROBES_README = 'Ad-hoc Playwright / pngjs probe scripts and their output live here, never in /tmp; they resolve stardust/node_modules (skills/stardust/reference/runtime-preflight.md).\n';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (flag('help')) {
  const text = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
  console.log(text); process.exit(0);
}
const unknown = args.filter((a) => a.startsWith('--') && !['--root', '--no-install', '--offline', '--skip', '--json', '--help'].includes(a));
if (unknown.length) { console.error(`preflight-runtime: unknown flag ${unknown.join(' ')} (--help)`); process.exit(2); }

export function findRoot(from) {
  let d = resolve(from);
  for (;;) {
    if (existsSync(join(d, 'stardust')) && statSync(join(d, 'stardust')).isDirectory()) return d;
    const up = dirname(d);
    if (up === d) return resolve(from);
    d = up;
  }
}
const root = opt('root') ? resolve(opt('root')) : findRoot(process.cwd());
const sd = join(root, 'stardust');
if (!existsSync(sd) || !statSync(sd).isDirectory()) { // never seed a fake project under a typo'd --root
  console.error(`preflight-runtime: no stardust/ under ${root} — run from the project root or pass --root <project> (master § Setup step 5 creates it); nothing written`);
  process.exit(2);
}
const noInstall = flag('no-install') || flag('offline');
const envPath = join(sd, '.work', 'env.json');

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, obj) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`); }

const real = (p) => { try { return realpathSync(p); } catch { return p; } };
/** Version of <pkg> as resolvable from <dir>/package.json, or null. With `under` (a node_modules dir) only a
 *  package installed BELOW it counts: Node's parent walk from stardust/package.json also reaches
 *  <root>/node_modules, and the EDS repo's own `npm i` prunes whatever its package.json did not declare —
 *  the failure class this preflight exists to remove, so such a hit is `missing`, never `ok`. */
export function resolveDep(dir, pkg, { under = null } = {}) {
  try {
    const req = createRequire(join(dir, 'package.json'));
    let p = dirname(req.resolve(pkg));
    while (p !== dirname(p)) {
      const pj = readJson(join(p, 'package.json'));
      if (pj && pj.name === pkg) return !under || real(p).startsWith(`${real(under)}${sep}`) ? { version: pj.version ?? 'unknown', dir: p } : null;
      p = dirname(p);
    }
  } catch { /* unresolved */ }
  return null;
}
function whichAll(names, pathEnv = process.env.PATH ?? '') {
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const out = {};
  for (const n of names) out[n] = dirs.map((d) => join(d, n)).find((p) => existsSync(p)) ?? null;
  return out;
}
function bashVersion() {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  const m = r.status === 0 ? r.stdout.match(/version (\d+)\.(\d+)/) : null;
  return m ? `${m[1]}.${m[2]}` : null;
}
function lintCheck() {
  const pj = readJson(join(root, 'package.json'));
  if (!pj) return 'n/a';
  const hasConfig = pj.eslintConfig || pj.devDependencies?.eslint || pj.dependencies?.eslint
    || ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs'].some((f) => existsSync(join(root, f)));
  if (!hasConfig) return 'n/a';
  const bin = existsSync(join(root, 'node_modules', '.bin', 'eslint'));
  const parser = !pj.devDependencies?.['@babel/eslint-parser'] || resolveDep(root, '@babel/eslint-parser');
  return bin && parser ? 'ok' : 'unavailable';
}

// --- skip -------------------------------------------------------------------
const prev = readJson(envPath) ?? {};
if (flag('skip')) {
  writeJson(envPath, { ...prev, projectRoot: root, preflight: 'skipped', writtenAt: new Date().toISOString() });
  console.log(`preflight-runtime: skipped (recorded in ${envPath})`);
  process.exit(0);
}

// --- 1. stardust/package.json + deps ----------------------------------------
const missing = [];
const pjPath = join(sd, 'package.json');
const pj = readJson(pjPath) ?? { name: 'stardust-deps', private: true, type: 'module', devDependencies: {} };
pj.devDependencies ??= {};
let changed = !existsSync(pjPath);
for (const d of DEPS) if (!pj.devDependencies[d]) { pj.devDependencies[d] = 'latest'; changed = true; }
if (changed && !noInstall) writeJson(pjPath, pj); // --no-install writes nothing tracked

let deps = Object.fromEntries(DEPS.map((d) => [d, resolveDep(sd, d, { under: join(sd, 'node_modules') })]));
const missingDeps = () => DEPS.filter((d) => !deps[d]);
const npmCmd = `npm i --prefix ${sd} --no-audit --no-fund`;
const selfCmd = `node ${fileURLToPath(import.meta.url)} --root ${root}`; // the full preflight, for --no-install callers
if (missingDeps().length && !noInstall) {
  console.log(`preflight-runtime: installing ${missingDeps().join(', ')} → ${join(sd, 'node_modules')}`);
  const r = spawnSync('npm', ['i', '--prefix', sd, '--no-audit', '--no-fund'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) console.error(`preflight-runtime: npm exited ${r.status}`);
  deps = Object.fromEntries(DEPS.map((d) => [d, resolveDep(sd, d, { under: join(sd, 'node_modules') })]));
}
if (missingDeps().length) missing.push(`missing: ${missingDeps().join(', ')} — run: ${noInstall ? selfCmd : npmCmd}`);
if (!noInstall && existsSync(join(sd, 'node_modules')) && !existsSync(join(sd, 'node_modules', '.gitignore'))) writeFileSync(join(sd, 'node_modules', '.gitignore'), '*\n');

// --- 2. chromium ------------------------------------------------------------
let chromium = 'unresolved';
let browserCmd = null;
if (deps.playwright) {
  browserCmd = `node ${join(deps.playwright.dir, 'cli.js')} install chromium`;
  const exe = async () => {
    try {
      const mod = await import(pathToFileURL(createRequire(join(sd, 'package.json')).resolve('playwright')).href);
      const pw = mod.chromium ? mod : mod.default;
      const p = pw?.chromium?.executablePath?.();
      return p && existsSync(p) ? p : null;
    } catch { return null; }
  };
  let p = await exe();
  if (!p && !noInstall && existsSync(join(deps.playwright.dir, 'cli.js'))) {
    console.log(`preflight-runtime: downloading chromium (${browserCmd})`);
    spawnSync(process.execPath, [join(deps.playwright.dir, 'cli.js'), 'install', 'chromium'], { stdio: ['ignore', 'ignore', 'inherit'] });
    p = await exe();
  }
  chromium = p ? 'ok' : 'missing';
  if (!p) missing.push(`missing: chromium — run: ${noInstall ? selfCmd : browserCmd}`);
} else missing.push('missing: chromium — resolve playwright first (above)');

// --- 3. probes dir ----------------------------------------------------------
const probes = join(sd, '.work', 'probes');
mkdirSync(probes, { recursive: true });
if (!existsSync(join(probes, 'README'))) writeFileSync(join(probes, 'README'), PROBES_README);

// --- 4 + 5. environment record ---------------------------------------------
const bash = bashVersion();
const lint = lintCheck();
if (lint === 'unavailable') missing.push(`lint unavailable — run: npm ci --legacy-peer-deps in ${root} (deploy never reports "eslint clean" while env.json.lint is unavailable)`);
const envFile = [join(root, '.env'), join(homedir(), '.claude', '.env')].find((p) => existsSync(p)) ?? null;
const record = {
  ...prev,
  projectRoot: root,
  nodeBin: process.execPath,
  nodeVersion: process.version,
  shell: process.env.SHELL ?? null,
  bash32: bash ? bash.startsWith('3.') : null,
  pathSnapshot: process.env.PATH ?? '',
  tools: whichAll(TOOLS),
  deps: Object.fromEntries(DEPS.map((d) => [d, deps[d]?.version ?? null])),
  chromium,
  lint,
  ports: prev.ports ?? {},
  envFile,
  preflight: missing.length ? 'partial' : 'ok',
  missing,
  writtenAt: new Date().toISOString(),
};
writeJson(envPath, record);

// git hygiene (advisory): the dependency dir must be ignored in a repo
if (existsSync(join(sd, 'node_modules')) && spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' }).status === 0) {
  const ci = spawnSync('git', ['check-ignore', '-q', join(sd, 'node_modules', 'playwright')], { cwd: root });
  if (ci.status !== 0) console.error(`preflight-runtime: warn — ${join(sd, 'node_modules')} is not git-ignored; add node_modules/ to stardust/.gitignore`);
}

if (flag('json')) { console.log(JSON.stringify(record, null, 2)); for (const m of missing) console.error(m); } // one actionable line per item, still
else {
  console.log(`preflight-runtime: ${DEPS.map((d) => `${d} ${record.deps[d] ?? 'missing'}`).join(' · ')} · chromium ${chromium} · lint ${lint} · probes ${probes}`);
  for (const m of missing) console.log(m);
}
process.exit(missing.length ? 1 : 0);
