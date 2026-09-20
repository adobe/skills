#!/usr/bin/env node
// Fixture test: the copy-as-a-set rule for the replica gate (replica SKILL.md § Setup step 4;
// harness-permissions.md § Two classes). The replica + diff scripts are copied into a temp project as
// the docs name them — stardust/scripts/replica/ + stardust/scripts/diff/ — WITH the stardust set
// (stardust/scripts/stardust/browser-lock.mjs + lib/resolve.mjs) and without it, and three copies are
// driven: gate.sh up to its round-slot step (the identity assertion against a closed port then ends the
// round, exit 4 — no capture, no network), diff/live-session.mjs launchTier with a fake chromium (the
// slot the copied live tools take), and replica/pixel-compare.mjs --help (pngjs/pixelmatch through
// ../stardust/lib/resolve.mjs → the resolve-chain fixture's stardust/node_modules stubs).
// Defect fixture: Setup step 4 named only replica/ + diff/, so the copy found no browser-lock.mjs
// (rounds ran unlocked after a WARN) and the CHAIN's ../stardust/lib/resolve.mjs missed (bare import).
// Second defect: browser-lock.mjs's CLI main guard compared resolve(argv[1]) with the symlink-resolved
// import.meta.url — under a symlinked path (macOS /var → /private/var, a linked project dir) `acquire` exited 0
// silently and gate.sh ran unlocked WITHOUT a WARN; the set case asserts the `acquired` line.
// No browser, no network. Usage: node plugins/stardust/skills/replica/scripts/test/copy-set.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKILLS = resolve(import.meta.dirname, '..', '..', '..');
const FIX = join(SKILLS, '..', 'evals', 'lint', 'fixtures', 'resolve-chain'); // stardust/package.json + stub playwright / pixelmatch / pngjs
const tmp = mkdtempSync(join(tmpdir(), 'replica-copy-set-'));
const noTests = (p) => !/\/test(\/|$)/.test(p);

/** The documented copy: replica/ + diff/ scripts; `withSet` adds the stardust/ pair Setup step 4 names. */
function copySet(root, { withSet = true } = {}) {
  const scripts = join(root, 'stardust', 'scripts');
  mkdirSync(join(root, 'stardust', 'replica'), { recursive: true });
  cpSync(join(SKILLS, 'replica', 'scripts'), join(scripts, 'replica'), { recursive: true, filter: noTests });
  cpSync(join(SKILLS, 'diff', 'scripts'), join(scripts, 'diff'), { recursive: true, filter: noTests });
  if (withSet) {
    mkdirSync(join(scripts, 'stardust', 'lib'), { recursive: true });
    cpSync(join(SKILLS, 'stardust', 'scripts', 'browser-lock.mjs'), join(scripts, 'stardust', 'browser-lock.mjs'));
    cpSync(join(SKILLS, 'stardust', 'scripts', 'lib', 'resolve.mjs'), join(scripts, 'stardust', 'lib', 'resolve.mjs'));
  }
  return scripts;
}
// GATE_REAP_MIN high: this test must never reap another run's instruments on the same machine
const env = (lockDir) => ({ ...process.env, STARDUST_BROWSER_LOCK_DIR: lockDir, STARDUST_BROWSER_SLOTS: '2', STARDUST_SKILLS_DIR: '', GATE_REAP_MIN: '100000', GATE_LANDMARKS: '0' });

/** gate.sh: the round-slot step runs before any capture; the identity curl against a closed port ends the round (exit 4). */
const gate = (scripts, lockDir, root) => spawnSync('bash', [join(scripts, 'replica', 'gate.sh'), 'copyset', 'https://example.test/', 'http://127.0.0.1:9/', '1440'], { cwd: root, encoding: 'utf8', env: env(lockDir) });

/** live-session launchTier (fake chromium): does the copied diff/live-session.mjs find ../stardust/browser-lock.mjs? */
function launch(scripts, lockDir) {
  const code = `import { launchTier } from ${JSON.stringify(pathToFileURL(join(scripts, 'diff', 'live-session.mjs')).href)}; import { readdirSync } from 'node:fs';
    const fake = { launch: async () => ({ on() {}, close: async () => {} }) };
    const a = await launchTier(fake, 1); await a.close(); const b = await launchTier(fake, 1); await b.close();
    console.log(JSON.stringify({ slots: readdirSync(${JSON.stringify(lockDir)}).length }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: FIX, encoding: 'utf8', env: env(lockDir) });
  assert.equal(r.status, 0, `launchTier probe failed\n${r.stderr}`);
  return { ...JSON.parse(r.stdout.trim().split('\n').pop()), stderr: r.stderr };
}

/** pixel-compare --help: the deps load first — through the chain (set) or the bare import (lone copy). */
const compare = (scripts) => spawnSync(process.execPath, [join(scripts, 'replica', 'pixel-compare.mjs'), '--help'], { cwd: FIX, encoding: 'utf8', env: { ...process.env, STARDUST_SKILLS_DIR: '' } });

try {
  // the set: slot taken and released by gate.sh, ONE slot per live-session process, chain resolves the stubs
  const root = join(tmp, 'set'); const lockDir = join(root, 'locks'); mkdirSync(lockDir, { recursive: true });
  const scripts = copySet(root);
  let g = gate(scripts, lockDir, root); let out = `${g.stdout}\n${g.stderr}`;
  assert.equal(g.status, 4, `set: gate.sh reaches the identity assertion (exit 4) after taking the slot\n${out}`);
  assert.match(out, /^acquired /m, `set: the copied gate.sh takes the round's browser slot from ../stardust/browser-lock.mjs\n${out}`);
  assert.doesNotMatch(out, /WARN no browser-lock/, `set: no unlocked WARN\n${out}`);
  assert.equal(readdirSync(lockDir).length, 0, 'set: gate.sh releases the slot on exit');
  let l = launch(scripts, lockDir);
  assert.equal(l.slots, 1, 'set: the copied live-session takes ONE machine slot for the process (two launches)');
  assert.doesNotMatch(l.stderr, /WARN browser-lock/, `set: no lock WARN from live-session\n${l.stderr}`);
  let c = compare(scripts);
  assert.equal(c.status, 0, `set: the copied pixel-compare loads pngjs + pixelmatch through ../stardust/lib/resolve.mjs (chain → stardust/node_modules)\n${c.stderr}`);
  assert.doesNotMatch(c.stderr, /Cannot find package/, 'set: no bare-import miss');

  // the lone copy (replica/ + diff/ only — the pre-fix Setup): unlocked after a WARN, no chain
  const lone = join(tmp, 'lone'); const loneLocks = join(lone, 'locks'); mkdirSync(loneLocks, { recursive: true });
  const loneScripts = copySet(lone, { withSet: false });
  g = gate(loneScripts, loneLocks, lone); out = `${g.stdout}\n${g.stderr}`;
  assert.equal(g.status, 4, `lone: the round still reaches the identity assertion\n${out}`);
  assert.match(out, /WARN no browser-lock\.mjs beside the scripts/, `lone: gate.sh warns it runs unlocked\n${out}`);
  assert.doesNotMatch(out, /^acquired /m, 'lone: no slot taken');
  l = launch(loneScripts, loneLocks);
  assert.equal(l.slots, 0, 'lone: live-session launches without a slot');
  assert.equal((l.stderr.match(/WARN browser-lock\.mjs not found/g) || []).length, 1, `lone: one lock WARN across two launches\n${l.stderr}`);
  assert.match(l.stderr, /harness-permissions\.md § Two classes/, 'the WARN names the set rule');
  c = compare(loneScripts);
  assert.equal(c.status, 2, `lone: pixel-compare exits 2 (preflight) — no chain, bare import misses\n${c.stderr}`);
  assert.match(c.stderr, /Cannot find package 'pngjs'|ERR_MODULE_NOT_FOUND/, `lone: the bare import is what missed\n${c.stderr}`);
  console.log('replica copy-set test: ok (set: gate.sh takes + releases the round slot, live-session takes one slot, pixel-compare resolves through the chain; lone copy: WARN + unlocked, bare import misses)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
