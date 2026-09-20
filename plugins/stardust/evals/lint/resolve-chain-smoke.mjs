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
//      stale entry fails.
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

// TEMPORARY — shrink per landed skill (replica+diff → reskin → deploy/dynamics/qa → fixtures + extract).
// Key: path relative to skills/. Value: why it still imports directly.
const ALLOW = {
  'deploy/scripts/ai-readability.mjs': 'inline cwd loader (T07.1 bridge) — convert with deploy',
  'deploy/scripts/block-roundtrip.mjs': 'static import — convert with deploy',
  'deploy/scripts/ew-editability-probe.mjs': 'inline cwd + npm root -g loader — convert with deploy',
  'deploy/scripts/qa-gate.mjs': 'static import — convert with deploy',
  'deploy/scripts/render-harness.mjs': 'static import — convert with deploy',
  'deploy/scripts/section-schema.mjs': 'static import — convert with deploy',
  'deploy/scripts/style-fingerprint.mjs': 'static import — convert with deploy',
  'diff/scripts/content-diff.mjs': 'static import — convert with replica+diff',
  'diff/scripts/visual-diff.mjs': 'static import — convert with replica+diff',
  'dynamics/scripts/lib.mjs': 'inline cwd loader (T07.1 bridge) — convert with dynamics/qa',
  'extract/scripts/crawl.mjs': 'ships alone into projects (launch-ladder lint) — last in the series',
  'migrate/fixtures/file-protocol-audit.mjs': 'fixture bare import — convert with the fixtures',
  'prototype/fixtures/mobile-nav-audit.mjs': 'fixture bare import — convert with the fixtures',
  'qa/scripts/lib.mjs': 'inline cwd loader (T07.1 bridge) — convert with dynamics/qa',
  'replica/scripts/anchor.mjs': 'static import + two-layout live-session probe — convert with replica+diff',
  'replica/scripts/chrome-parity.mjs': 'static import — convert with replica+diff',
  'replica/scripts/chrome-states.mjs': 'lazy import (pure halves need no browser) — convert with replica+diff',
  'replica/scripts/layout-cluster.mjs': 'lazy import (pure halves need no browser) — convert with replica+diff',
  'replica/scripts/lift.mjs': 'lazy import (pure halves need no browser) — convert with replica+diff',
  'replica/scripts/motion-assert.mjs': 'lazy import (pure halves need no browser) — convert with replica+diff',
  'replica/scripts/crop-compare.mjs': 'static import — convert with replica+diff',
  'replica/scripts/motion-observe.mjs': 'static import + two-layout probe — convert with replica+diff',
  'replica/scripts/pixel-compare.mjs': 'static import — convert with replica+diff',
  'replica/scripts/review-image.mjs': 'static import — convert with replica+diff',
  'replica/scripts/row-profile.mjs': 'static import — convert with replica+diff',
  'replica/scripts/sibling-variance.mjs': 'static import — convert with replica+diff',
  'replica/scripts/stitch-shot.mjs': 'static import — convert with replica+diff',
  'replica/scripts/variant-census.mjs': 'lazy import (pure halves need no browser) — convert with replica+diff',
  'reskin/scripts/capture-content.mjs': 'dynamic import — convert with reskin',
  'reskin/scripts/dom-equality.mjs': 'dynamic import — convert with reskin',
  'reskin/scripts/donor-probe.mjs': 'dynamic import — convert with reskin',
  'reskin/scripts/slot-coverage.mjs': 'dynamic import — convert with reskin',
};
// Not importers: the preflight resolves the packages on purpose; the helper is the chain.
const EXEMPT = new Set(['stardust/scripts/preflight-runtime.mjs', 'stardust/scripts/lib/resolve.mjs']);

const findings = [];
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-chain-'))); // realpath: cwd is reported resolved (/private/var on macOS)
try {
  // 1. the stardust/package.json link, from the fixture root and from a sub-directory
  const from = pathToFileURL(join(tmp, 'plugin', 'skills', 'x', 'scripts', 'probe.mjs')).href;
  const pw = await resolveDep('playwright', { from, cwd: FIX, global: false });
  assert.deepEqual(pw.chromium, { stub: true }, 'playwright stub resolves through stardust/package.json');
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
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mjs')) files.push(p); } })(SKILLS);
const used = new Set();
let importers = 0;
for (const f of files) {
  const key = relative(SKILLS, f);
  if (EXEMPT.has(key) || /\/test\//.test(key) || !/^[^/]+\/(scripts|fixtures)\//.test(key)) continue;
  const src = readFileSync(f, 'utf8');
  if (!DEP.test(src)) continue;
  importers += 1;
  if (src.includes('stardust/scripts/lib/resolve.mjs')) continue;
  if (ALLOW[key]) { used.add(key); continue; }
  findings.push(`${relative(process.cwd(), f)}: imports ${src.match(DEP)[1]} directly — go through skills/stardust/scripts/lib/resolve.mjs (resolveDep/resolveDeps) or list it in ALLOW with a reason`);
}
for (const k of Object.keys(ALLOW)) if (!used.has(k)) findings.push(`stale ALLOW entry "${k}" — remove it (${ALLOW[k]})`);

if (findings.length) { console.error(`resolve-chain smoke: ${findings.length} finding(s)\n${findings.join('\n')}`); process.exit(1); }
console.log(`resolve-chain smoke: chain ok (stardust/ link, sub-dir walk-up, exit-2 line, siblingScript ×3); ${importers} importers, ${used.size} allowlisted (must shrink), ${importers - used.size} through lib/resolve.mjs`);
