#!/usr/bin/env node
// Fixture test: the copy-as-a-set rule for crawl.mjs (harness-permissions.md § Two classes; extract SKILL
// § Setup). The six extract scripts are copied into a temp project with skills/stardust/scripts/
// {progress,browser-lock}.mjs + lib/resolve.mjs beside them, in BOTH layouts the docs name — flat
// (stardust/scripts/crawl.mjs) and nested (stardust/scripts/extract/crawl.mjs) — and a child process
// imports the copy and asserts the three loaders land: the real progress helper (no WARN), playwright
// through the resolution chain (the fixture stub under stardust/node_modules), and ONE browser slot taken
// by launchTier. A lone copy (no stardust set) runs unlocked after one WARN per loader, 0 slots.
// Before the fix the flat copy took no slot (lockPaths knew only ../stardust/) and the nested copy found
// no progress helper / chain (their loaders knew only ./stardust/) — silently, no WARN.
// No browser (fake chromium.launch), no network.
// Usage: node plugins/stardust/skills/extract/scripts/test/copy-set.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKILLS = resolve(import.meta.dirname, '..', '..', '..');
const FIX = join(SKILLS, '..', 'evals', 'lint', 'fixtures', 'resolve-chain'); // stardust/package.json + stub playwright
const EXTRACT = ['crawl', 'validate-page', 'brand-surface', 'write-design-json', 'brand-review', 'state-update'];
const tmp = mkdtempSync(join(tmpdir(), 'copy-set-'));

function copySet(root, layout, { withSet = true } = {}) {
  const scripts = join(root, 'stardust', 'scripts');
  const dir = layout === 'flat' ? scripts : join(scripts, 'extract');
  mkdirSync(dir, { recursive: true });
  for (const f of EXTRACT) cpSync(join(SKILLS, 'extract', 'scripts', `${f}.mjs`), join(dir, `${f}.mjs`));
  if (withSet) {
    mkdirSync(join(scripts, 'stardust', 'lib'), { recursive: true });
    for (const f of ['progress', 'browser-lock']) cpSync(join(SKILLS, 'stardust', 'scripts', `${f}.mjs`), join(scripts, 'stardust', `${f}.mjs`));
    cpSync(join(SKILLS, 'stardust', 'scripts', 'lib', 'resolve.mjs'), join(scripts, 'stardust', 'lib', 'resolve.mjs'));
  }
  return join(dir, 'crawl.mjs');
}

function probe(crawl, lockDir) {
  const code = `import { loadProgressHelper, loadPlaywright, launchTier } from ${JSON.stringify(pathToFileURL(crawl).href)}; import { readdirSync } from 'node:fs';
    const prog = await loadProgressHelper();
    let pw = null; try { pw = await loadPlaywright(); } catch (e) { pw = { error: e.code || e.message }; }
    const fake = { launch: async () => ({ on() {}, close: async () => {} }) };
    const a = await launchTier(fake, 1); await a.close(); const b = await launchTier(fake, 1); await b.close();
    console.log(JSON.stringify({ realProgress: typeof prog.writeAtomic === 'function', stub: !!(pw && pw.chromium && pw.chromium.stub), pw: pw && pw.error, slots: readdirSync(${JSON.stringify(lockDir)}).length }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: FIX, encoding: 'utf8', env: { ...process.env, STARDUST_BROWSER_LOCK_DIR: lockDir, STARDUST_BROWSER_SLOTS: '2', STARDUST_SKILLS_DIR: '' } });
  assert.equal(r.status, 0, `probe of ${crawl} failed\n${r.stderr}`);
  return { ...JSON.parse(r.stdout.trim().split('\n').pop()), stderr: r.stderr };
}

try {
  for (const layout of ['flat', 'nested']) {
    const root = join(tmp, layout); const lockDir = join(root, 'locks'); mkdirSync(lockDir, { recursive: true });
    const crawl = copySet(root, layout);
    const got = probe(crawl, lockDir);
    assert.equal(got.realProgress, true, `${layout}: the real progress.mjs is loaded from stardust/scripts/stardust/`);
    assert.equal(got.stub, true, `${layout}: playwright resolves through lib/resolve.mjs (chain → stardust/node_modules stub), got ${got.pw}`);
    assert.equal(got.slots, 1, `${layout}: launchTier takes ONE machine slot for the process (two launches)`);
    assert.doesNotMatch(got.stderr, /WARN/, `${layout}: no loader WARN when the set is complete\n${got.stderr}`);
    assert.equal(readdirSync(lockDir).length, 0, `${layout}: the slot is released at exit`);
  }
  // a lone copy: every loader misses → one WARN each, the run is unlocked (0 slots) and still runs
  const root = join(tmp, 'lone'); const lockDir = join(root, 'locks'); mkdirSync(lockDir, { recursive: true });
  const got = probe(copySet(root, 'flat', { withSet: false }), lockDir);
  assert.equal(got.realProgress, false, 'lone copy: inline SUMMARY fallback');
  assert.equal(got.slots, 0, 'lone copy: no lock module → unlocked');
  assert.equal((got.stderr.match(/WARN progress\.mjs not found/g) || []).length, 1, `lone copy: one progress WARN\n${got.stderr}`);
  assert.equal((got.stderr.match(/WARN browser-lock\.mjs not found/g) || []).length, 1, `lone copy: one lock WARN across two launches\n${got.stderr}`);
  assert.match(got.stderr, /harness-permissions\.md § Two classes/, 'the WARN names the set rule');
  console.log('copy-set test: ok (flat + nested project copies load progress, resolve playwright through the chain and take one slot; a lone copy warns once per loader and runs unlocked)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
