#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/preflight-runtime.mjs — the runtime preflight contract.
 * Run: node skills/stardust/scripts/test/preflight-runtime.test.mjs   (exit 1 on failure; no network)
 *   - empty project, --no-install → exit 1 naming exactly the three packages + chromium, each line pointing at
 *     the full preflight command; nothing tracked is written (no stardust/package.json); <root>/package.json
 *     never created; under --json the same lines go to stderr and env.json / the record carry `missing`;
 *   - --root on a directory with no stardust/ → exit 2 and nothing created (a typo'd root never seeds a project);
 *   - stubbed stardust/node_modules/{playwright,pixelmatch,pngjs} → exit 0, env.json carries the record keys,
 *     deps versions, chromium ok, probes README; a second run is byte-identical except writtenAt; without
 *     --no-install the same tree gets stardust/package.json (merged, three devDependencies) and no npm spawn;
 *   - eslint setup in <root>/package.json with no node_modules → lint "unavailable", the loud line, exit 1 and
 *     preflight "partial" (negative fixture: the same tree with eslint resolvable exits 0); the root
 *     package.json is byte-identical after the run; `transports` from preflight-transports survives the merge;
 *   - --skip records preflight "skipped"; --help exits 0; an unknown flag exits 2.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'preflight-runtime.mjs');
const run = (root, ...extra) => spawnSync(process.execPath, [CLI, '--root', root, ...extra], { encoding: 'utf8' });
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'preflight-runtime-'));

function stubDeps(root) {
  const nm = join(root, 'stardust', 'node_modules');
  const exe = join(root, 'fake-chromium');
  writeFileSync(exe, '');
  for (const [name, version] of [['playwright', '1.99.0'], ['pixelmatch', '6.0.0'], ['pngjs', '7.0.0']]) {
    mkdirSync(join(nm, name), { recursive: true });
    writeFileSync(join(nm, name, 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'index.js' }));
    writeFileSync(join(nm, name, 'index.js'), name === 'playwright'
      ? `export const chromium = { executablePath: () => ${JSON.stringify(exe)} };\n`
      : 'export default {};\n');
  }
}

try {
  // (a) empty project
  const a = join(dir, 'a');
  mkdirSync(join(a, 'stardust'), { recursive: true });
  let r = run(a, '--no-install');
  assert.equal(r.status, 1, `empty project exits 1\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^missing: playwright, pixelmatch, pngjs — run: node \S*preflight-runtime\.mjs --root /m, '--no-install points at the full preflight, not npm');
  assert.match(r.stdout, /^missing: chromium — resolve playwright first/m);
  assert.equal(r.stdout.match(/^missing:/gm).length, 2, 'exactly two missing lines');
  assert.ok(!existsSync(join(a, 'stardust', 'package.json')), '--no-install writes nothing tracked');
  assert.ok(!existsSync(join(a, 'package.json')), '<root>/package.json is never created');
  let env = json(join(a, 'stardust', '.work', 'env.json'));
  assert.equal(env.preflight, 'partial');
  assert.deepEqual(env.deps, { playwright: null, pixelmatch: null, pngjs: null });
  assert.equal(env.chromium, 'unresolved');
  assert.ok(existsSync(join(a, 'stardust', '.work', 'probes', 'README')), 'probes dir + README created');
  assert.deepEqual(env.missing, r.stdout.split('\n').filter((l) => l.startsWith('missing:')), 'env.json.missing holds the actionable lines');
  // --json keeps the one-line-per-item contract: record on stdout, the lines on stderr
  r = run(a, '--no-install', '--json');
  assert.equal(r.status, 1, '--json still exits 1');
  const rec = JSON.parse(r.stdout);
  assert.equal(rec.preflight, 'partial'); assert.equal(rec.missing.length, 2, 'record carries missing');
  assert.equal(r.stderr.match(/^missing:/gm)?.length, 2, `--json prints the two actionable lines on stderr\n${r.stderr}`);
  // (f) a root without stardust/ is refused before any write
  const f = join(dir, 'f'); mkdirSync(f);
  r = run(f, '--no-install');
  assert.equal(r.status, 2, `no stardust/ under --root exits 2\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /no stardust\/ under .* nothing written/);
  assert.ok(!existsSync(join(f, 'stardust')), 'nothing created under a typo\'d --root');
  r = run(f, '--skip');
  assert.equal(r.status, 2, '--skip cannot seed a project either'); assert.ok(!existsSync(join(f, 'stardust')));

  // (b) stubbed deps → ok; (c) idempotent
  const b = join(dir, 'b');
  mkdirSync(join(b, 'stardust', '.work'), { recursive: true });
  writeFileSync(join(b, 'stardust', '.work', 'env.json'), JSON.stringify({ transports: { 'gh-user': 'ok' } }));
  stubDeps(b);
  r = run(b, '--no-install');
  assert.equal(r.status, 0, `stubbed project exits 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^preflight-runtime: playwright 1\.99\.0 · pixelmatch 6\.0\.0 · pngjs 7\.0\.0 · chromium ok · lint n\/a · probes /m);
  env = json(join(b, 'stardust', '.work', 'env.json'));
  for (const k of ['projectRoot', 'nodeBin', 'nodeVersion', 'shell', 'bash32', 'pathSnapshot', 'tools', 'deps', 'chromium', 'lint', 'ports', 'envFile', 'preflight', 'writtenAt']) assert.ok(k in env, `env.json has ${k}`);
  assert.equal(env.preflight, 'ok');
  assert.equal(env.projectRoot, b);
  assert.deepEqual(env.deps, { playwright: '1.99.0', pixelmatch: '6.0.0', pngjs: '7.0.0' });
  assert.deepEqual(env.ports, {});
  assert.deepEqual(env.transports, { 'gh-user': 'ok' }, 'merge keeps the transports block');
  assert.ok(!existsSync(join(b, 'stardust', 'node_modules', '.gitignore')), '--no-install writes nothing under the tracked tree');
  const first = { ...env, writtenAt: null };
  r = run(b, '--no-install', '--json');
  assert.equal(r.status, 0);
  const second = { ...json(join(b, 'stardust', '.work', 'env.json')), writtenAt: null };
  assert.deepEqual(second, first, 'second run byte-identical except writtenAt');
  assert.equal(JSON.parse(r.stdout).preflight, 'ok', '--json prints the record');
  // (c2) install mode on a resolvable tree: the manifest is written / merged, no npm spawn, still exit 0
  writeFileSync(join(b, 'stardust', 'package.json'), JSON.stringify({ name: 'stardust-deps', private: true, type: 'module', devDependencies: { pngjs: '^7' } }));
  r = run(b);
  assert.equal(r.status, 0, `install mode on a resolvable tree exits 0\n${r.stdout}${r.stderr}`);
  assert.ok(!/installing|downloading/.test(r.stdout), 'nothing to install → no npm / browser spawn');
  const pj = json(join(b, 'stardust', 'package.json'));
  assert.equal(pj.private, true);
  assert.deepEqual(pj.devDependencies, { pngjs: '^7', playwright: 'latest', pixelmatch: 'latest' }, 'merged, existing pin kept');
  assert.equal(readFileSync(join(b, 'stardust', 'node_modules', '.gitignore'), 'utf8'), '*\n', 'node_modules/.gitignore = * for older project copies');

  // (d) lint unavailable, root package.json untouched
  const d = join(dir, 'd');
  mkdirSync(join(d, 'stardust'), { recursive: true });
  const rootPj = JSON.stringify({ name: 'eds-site', devDependencies: { eslint: '8.x', '@babel/eslint-parser': '7.x' } }, null, 2);
  writeFileSync(join(d, 'package.json'), rootPj);
  stubDeps(d);
  r = run(d, '--offline');
  assert.equal(r.status, 1, `lint unavailable in a repo that declares it exits 1\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /chromium ok · lint unavailable/);
  assert.match(r.stdout, /^lint unavailable — run: npm ci --legacy-peer-deps in /m);
  assert.equal(r.stdout.match(/^lint unavailable/gm).length, 1, 'the loud line prints once');
  assert.ok(!/^missing:/m.test(r.stdout), 'deps and chromium are present — lint is the only item');
  assert.equal(readFileSync(join(d, 'package.json'), 'utf8'), rootPj, 'root package.json byte-identical');
  env = json(join(d, 'stardust', '.work', 'env.json'));
  assert.equal(env.lint, 'unavailable');
  assert.equal(env.preflight, 'partial', 'lint unavailable is a partial preflight');
  // negative fixture: eslint + parser resolvable from <root> → lint ok, exit 0
  mkdirSync(join(d, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(d, 'node_modules', '.bin', 'eslint'), '');
  mkdirSync(join(d, 'node_modules', '@babel', 'eslint-parser'), { recursive: true });
  writeFileSync(join(d, 'node_modules', '@babel', 'eslint-parser', 'package.json'), JSON.stringify({ name: '@babel/eslint-parser', version: '7.0.0', main: 'index.js' }));
  writeFileSync(join(d, 'node_modules', '@babel', 'eslint-parser', 'index.js'), 'module.exports = {};\n');
  r = run(d, '--offline');
  assert.equal(r.status, 0, `lint resolvable exits 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /chromium ok · lint ok/);
  assert.equal(json(join(d, 'stardust', '.work', 'env.json')).preflight, 'ok');

  // (e) --skip, --help, unknown flag
  r = run(a, '--skip');
  assert.equal(r.status, 0);
  assert.equal(json(join(a, 'stardust', '.work', 'env.json')).preflight, 'skipped');
  r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Exit codes: 0/);
  r = run(a, '--bogus');
  assert.equal(r.status, 2, 'unknown flag exits 2');
  console.log('preflight-runtime test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
