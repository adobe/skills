#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/preflight-runtime.mjs — the runtime preflight contract.
 * Run: node skills/stardust/scripts/test/preflight-runtime.test.mjs   (exit 1 on failure; no network)
 *   - empty project, --no-install → exit 1 naming exactly the three packages + chromium; stardust/package.json
 *     written with the three devDependencies; <root>/package.json never created;
 *   - stubbed stardust/node_modules/{playwright,pixelmatch,pngjs} → exit 0, env.json carries the record keys,
 *     deps versions, chromium ok, probes README; a second run is byte-identical except writtenAt;
 *   - eslint setup in <root>/package.json with no node_modules → lint "unavailable" + the loud line; the root
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
  assert.match(r.stdout, /^missing: playwright, pixelmatch, pngjs — run: npm i --prefix .*stardust --no-audit --no-fund$/m);
  assert.match(r.stdout, /^missing: chromium — /m);
  assert.equal(r.stdout.match(/^missing:/gm).length, 2, 'exactly two missing lines');
  const pj = json(join(a, 'stardust', 'package.json'));
  assert.equal(pj.private, true);
  assert.deepEqual(Object.keys(pj.devDependencies).sort(), ['pixelmatch', 'playwright', 'pngjs']);
  assert.ok(!existsSync(join(a, 'package.json')), '<root>/package.json is never created');
  let env = json(join(a, 'stardust', '.work', 'env.json'));
  assert.equal(env.preflight, 'partial');
  assert.deepEqual(env.deps, { playwright: null, pixelmatch: null, pngjs: null });
  assert.equal(env.chromium, 'unresolved');
  assert.ok(existsSync(join(a, 'stardust', '.work', 'probes', 'README')), 'probes dir + README created');

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
  assert.equal(readFileSync(join(b, 'stardust', 'node_modules', '.gitignore'), 'utf8'), '*\n');
  const first = { ...env, writtenAt: null };
  r = run(b, '--no-install', '--json');
  assert.equal(r.status, 0);
  const second = { ...json(join(b, 'stardust', '.work', 'env.json')), writtenAt: null };
  assert.deepEqual(second, first, 'second run byte-identical except writtenAt');
  assert.equal(JSON.parse(r.stdout).preflight, 'ok', '--json prints the record');

  // (d) lint unavailable, root package.json untouched
  const d = join(dir, 'd');
  mkdirSync(join(d, 'stardust'), { recursive: true });
  const rootPj = JSON.stringify({ name: 'eds-site', devDependencies: { eslint: '8.x', '@babel/eslint-parser': '7.x' } }, null, 2);
  writeFileSync(join(d, 'package.json'), rootPj);
  stubDeps(d);
  r = run(d, '--offline');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /chromium ok · lint unavailable/);
  assert.match(r.stdout, /^lint unavailable — run: npm ci --legacy-peer-deps in /m);
  assert.equal(readFileSync(join(d, 'package.json'), 'utf8'), rootPj, 'root package.json byte-identical');
  assert.equal(json(join(d, 'stardust', '.work', 'env.json')).lint, 'unavailable');

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
