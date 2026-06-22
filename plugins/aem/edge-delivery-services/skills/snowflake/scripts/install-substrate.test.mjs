import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(HERE, 'install-substrate.mjs');

// A minimal scripts.js that mimics the stock boilerplate anchors.
const STOCK_SCRIPTS = `import {
  decorateTemplateAndTheme,
  decorateMain,
  loadSection,
  loadSections,
  waitForFirstImage,
} from './aem.js';

async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }
}

async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);
}

loadEager(document);
`;

function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}');
  const all = { 'scripts/scripts.js': STOCK_SCRIPTS, ...files };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function runInstaller(dir, args = []) {
  try {
    const stdout = execFileSync('node', [INSTALLER, ...args], { cwd: dir, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

test('fresh install hooks scripts.js and copies the engine', () => {
  const dir = makeRepo();
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 0, r.stderr);
    const scripts = read(dir, 'scripts/scripts.js');
    assert.match(scripts, /import \{ applyTemplateOverlay \} from '\.\/overlay-engine\.js';/);
    assert.match(scripts, /if \(main && await applyTemplateOverlay\(main\)\)/);
    assert.ok(existsSync(join(dir, 'scripts/overlay-engine.js')), 'engine copied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inject is idempotent — second run adds nothing', () => {
  const dir = makeRepo();
  try {
    runInstaller(dir);
    const after1 = read(dir, 'scripts/scripts.js');
    runInstaller(dir);
    const after2 = read(dir, 'scripts/scripts.js');
    assert.equal(after1, after2, 'second run changed scripts.js');
    const importCount = (after2.match(/from '\.\/overlay-engine\.js'/g) || []).length;
    assert.equal(importCount, 1, 'import duplicated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing loadEager anchor fails loud and does not mis-patch', () => {
  const mangled = STOCK_SCRIPTS.replace('  decorateTemplateAndTheme();\n', '');
  const dir = makeRepo({ 'scripts/scripts.js': mangled });
  // Note: the 8 replace files + overlay-engine.js may still be copied; only
  // the scripts.js hook is aborted. Full pre-hook detection lands in Task 3.
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 2, 'should exit 2 on missing anchor');
    assert.match(r.stderr, /could not find the anchor for "overlay-eager-hook"/);
    assert.doesNotMatch(read(dir, 'scripts/scripts.js'), /applyTemplateOverlay\(main\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partial hook (import present, guard missing) is completed on re-run', () => {
  const dir = makeRepo();
  try {
    runInstaller(dir);                       // full install: import + guard
    // Simulate a repo whose scripts.js has the import (marker present) and
    // byte-matching engine files, but is missing the loadEager guard — e.g.
    // a future substrate added an inject edit that this install predates.
    const guard = `  if (main && await applyTemplateOverlay(main)) {
    document.body.classList.add('appear');
    return;
  }
`;
    const scripts = read(dir, 'scripts/scripts.js');
    assert.ok(scripts.includes(guard), 'precondition: guard was installed');
    writeFileSync(join(dir, 'scripts/scripts.js'), scripts.replace(guard, ''));
    assert.doesNotMatch(read(dir, 'scripts/scripts.js'), /applyTemplateOverlay\(main\)/);

    const r = runInstaller(dir);             // re-run must re-add the guard
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(dir, 'scripts/scripts.js'), /if \(main && await applyTemplateOverlay\(main\)\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('already-installed second run reports no-op', () => {
  const dir = makeRepo();
  try {
    runInstaller(dir);
    const r = runInstaller(dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /no-op|already installed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a custom edit elsewhere in scripts.js survives install', () => {
  const custom = STOCK_SCRIPTS.replace(
    'async function loadLazy(doc) {',
    'function myCustomBlock() { /* SURVIVE-ME */ }\n\nasync function loadLazy(doc) {',
  );
  const dir = makeRepo({ 'scripts/scripts.js': custom });
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(dir, 'scripts/scripts.js'), /SURVIVE-ME/, 'custom code was clobbered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
