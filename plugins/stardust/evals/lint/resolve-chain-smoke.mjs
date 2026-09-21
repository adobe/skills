#!/usr/bin/env node
// Smoke: skills/stardust/scripts/lib/resolve.mjs — the dependency / sibling-script
// resolution chain (reference/runtime-preflight.md § Resolution chain).
//
// Why: 26 plugin scripts import playwright / pixelmatch / pngjs; from the plugin
// tree a bare import cannot resolve, so agents copied scripts into projects and
// re-installed the same packages hundreds of times. The chain (script dir → cwd →
// nearest stardust/package.json → npm root -g) is what every importer must use.
//
// Checks (no network, no real dependency):
//   1. resolveDep('playwright') with cwd = fixtures/resolve-chain returns the stub
//      (the stardust/package.json link), also from a sub-directory of the fixture;
//   2. cwd = bare temp dir + PATH with a fake `npm` printing an empty root → exit 2
//      through exit2(), the line names preflight-runtime.mjs;
//   3. siblingScript('diff', 'live-session.mjs') resolves in the plugin layout, in a
//      flat copy layout (<tmp>/replica/anchor.mjs + <tmp>/diff/live-session.mjs) and
//      via STARDUST_SKILLS_DIR; throws naming the three when none exists;
//   4. static: every skills/*/scripts/**/*.mjs or skills/*/fixtures/*.mjs that names
//      one of the three packages imports it through lib/resolve.mjs — ALLOW below
//      lists the importers not yet converted and MUST shrink per landed skill; a
//      stale entry fails. The summary counts every importer (bare import OR a
//      resolveDep/loadDep call naming the package), so the line is the tree's size.
// Usage: node plugins/stardust/evals/lint/resolve-chain-smoke.mjs  (exit 1 on findings)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDep, resolveDepPath, resolveDeps, siblingScript, chainDirs, PREFLIGHT_HINT } from '../../skills/stardust/scripts/lib/resolve.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SKILLS = join(ROOT, 'skills');
const FIX = join(import.meta.dirname, 'fixtures', 'resolve-chain');
const RESOLVE = join(SKILLS, 'stardust', 'scripts', 'lib', 'resolve.mjs');

// Every importer is on the chain (T07.5 complete: dynamics, qa, extract, replica, diff, reskin, deploy and the two
// fixtures). An entry added here names an importer that is NOT yet converted — key: path relative to skills/,
// value: why it still imports directly — and MUST shrink again per landed skill; a stale entry fails the lint.
const ALLOW = {};
// Not importers: the preflight resolves the packages on purpose; the helper is the chain.
const EXEMPT = new Set(['stardust/scripts/preflight-runtime.mjs', 'stardust/scripts/lib/resolve.mjs']);

const findings = [];
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-chain-'))); // realpath: cwd is reported resolved (/private/var on macOS)
try {
  // 1. the stardust/package.json link, from the fixture root and from a sub-directory
  const from = pathToFileURL(join(tmp, 'plugin', 'skills', 'x', 'scripts', 'probe.mjs')).href;
  const pwPath = resolveDepPath('playwright', { from, cwd: FIX, global: false });
  assert.ok(pwPath.startsWith(join(FIX, 'stardust', 'node_modules')), `playwright must resolve to the fixture stub, not ${pwPath} — a node_modules above the fixture (e.g. plugins/stardust/node_modules) shadows it; remove it`);
  const pw = await resolveDep('playwright', { from, cwd: FIX, global: false });
  assert.equal(pw.chromium && pw.chromium.stub, true, 'playwright stub resolves through stardust/package.json');
  const sub = join(FIX, 'stardust', '.work', 'replica');
  assert.equal(resolveDepPath('pngjs', { from, cwd: sub, global: false }), join(FIX, 'stardust', 'node_modules', 'pngjs', 'index.js'), 'sub-directory cwd walks up to stardust/');
  const both = await resolveDeps(['pixelmatch', 'pngjs'], { from, cwd: FIX, global: false });
  assert.equal(typeof both.pixelmatch, 'function', 'default export normalised');
  assert.ok(both.pngjs.PNG, 'named export kept');
  assert.deepEqual(chainDirs({ from, cwd: sub, global: false }), [join(tmp, 'plugin', 'skills', 'x', 'scripts'), sub, join(FIX, 'stardust')], 'chain order: script dir → cwd → stardust/');

  // 2. every link empty → exit 2 with the preflight line (fake npm prints an empty root)
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho ""\n');
  chmodSync(join(bin, 'npm'), 0o755);
  const bare = join(tmp, 'bare');
  mkdirSync(bare);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { resolveDep, exit2 } from ${JSON.stringify(pathToFileURL(RESOLVE).href)}; await resolveDep('playwright', { script: 'probe.mjs' }).catch(exit2); console.log('resolved?!');`],
  { cwd: bare, encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(child.status, 2, `no link → exit 2\n${child.stdout}${child.stderr}`);
  assert.match(child.stderr, new RegExp(`^probe\\.mjs: cannot resolve 'playwright' from ${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — ${PREFLIGHT_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.ok(!child.stdout.includes('resolved?!'));

  // 3. siblingScript: plugin layout · flat copy · STARDUST_SKILLS_DIR · none
  const anchor = pathToFileURL(join(SKILLS, 'replica', 'scripts', 'anchor.mjs')).href;
  assert.equal(siblingScript('diff', 'live-session.mjs', { from: anchor, env: {} }), join(SKILLS, 'diff', 'scripts', 'live-session.mjs'), 'plugin layout');
  const flat = join(tmp, 'flat');
  mkdirSync(join(flat, 'replica'), { recursive: true }); mkdirSync(join(flat, 'diff'));
  writeFileSync(join(flat, 'diff', 'live-session.mjs'), '');
  assert.equal(siblingScript('diff', 'live-session.mjs', { from: pathToFileURL(join(flat, 'replica', 'anchor.mjs')).href, env: {} }), join(flat, 'diff', 'live-session.mjs'), 'flat copy layout');
  const skillsDir = join(tmp, 'skills-dir');
  mkdirSync(join(skillsDir, 'diff', 'scripts'), { recursive: true });
  writeFileSync(join(skillsDir, 'diff', 'scripts', 'live-session.mjs'), '');
  const orphan = pathToFileURL(join(tmp, 'orphan', 'replica', 'scripts', 'anchor.mjs')).href;
  assert.equal(siblingScript('diff', 'live-session.mjs', { from: orphan, env: { STARDUST_SKILLS_DIR: skillsDir } }), join(skillsDir, 'diff', 'scripts', 'live-session.mjs'), 'STARDUST_SKILLS_DIR');
  assert.throws(() => siblingScript('diff', 'live-session.mjs', { from: orphan, env: {} }), /: sibling script diff\/live-session\.mjs not found — tried .*orphan\/diff\/scripts\/live-session\.mjs, .*orphan\/replica\/diff\/live-session\.mjs \(set STARDUST_SKILLS_DIR/, 'names the layouts tried');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 4. static: importers go through lib/resolve.mjs
const DEP = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|\.resolve\s*\(\s*)['"](playwright|pixelmatch|pngjs)['"]/;
// a converted importer: names the package through the chain's entry points (the summary counts these too —
// defect: only bare-import files were counted, so the line said 7 importers for a tree of 37)
const CHAIN_DEP = /(?:resolveDeps?|loadDeps?)\s*\(\s*\[?\s*['"](playwright|pixelmatch|pngjs)['"]/;
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mjs')) files.push(p); } })(SKILLS);
const used = new Set();
let importers = 0;
for (const f of files) {
  const key = relative(SKILLS, f);
  if (EXEMPT.has(key) || /\/test\//.test(key) || !/^[^/]+\/(scripts|fixtures)\//.test(key)) continue;
  const src = readFileSync(f, 'utf8');
  const viaChain = src.includes('stardust/scripts/lib/resolve.mjs') && CHAIN_DEP.test(src);
  if (!DEP.test(src) && !viaChain) continue;
  importers += 1;
  if (src.includes('stardust/scripts/lib/resolve.mjs')) continue;
  if (ALLOW[key]) { used.add(key); continue; }
  findings.push(`${relative(process.cwd(), f)}: imports ${src.match(DEP)[1]} directly — go through skills/stardust/scripts/lib/resolve.mjs (resolveDep/resolveDeps) or list it in ALLOW with a reason`);
}
for (const k of Object.keys(ALLOW)) if (!used.has(k)) findings.push(`stale ALLOW entry "${k}" — remove it (${ALLOW[k]})`);

if (findings.length) { console.error(`resolve-chain smoke: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
console.log(`resolve-chain smoke: chain ok (stardust/ link, sub-dir walk-up, exit-2 line, siblingScript ×3); ${importers} importers, ${used.size} allowlisted (must shrink), ${importers - used.size} through lib/resolve.mjs`);
