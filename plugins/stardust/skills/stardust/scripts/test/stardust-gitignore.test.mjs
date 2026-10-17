#!/usr/bin/env node
// skills/stardust/scripts/test/stardust-gitignore.test.mjs — reference/stardust.gitignore installed as
// stardust/.gitignore in a scratch git repo (what Setup step 6 does): the gate's JSON sidecars under
// replica/gates/ are tracked at any depth, its renders and diffs are not, and the other heavy folders and
// run residue stay ignored. Asks `git check-ignore`; no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IGNORE = join(HERE, '..', '..', 'reference', 'stardust.gitignore');
const root = mkdtempSync(join(tmpdir(), 'stardust-gitignore-'));
const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
assert.equal(git('init', '-q').status, 0, 'git init');
mkdirSync(join(root, 'stardust'), { recursive: true });
copyFileSync(IGNORE, join(root, 'stardust', '.gitignore'));

const touch = (rel) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), 'x'); };
const ignored = (rel) => { touch(rel); const r = git('check-ignore', '-q', '--', rel); assert.ok(r.status === 0 || r.status === 1, r.stderr); return r.status === 0; };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('the gate\'s JSON sidecars are tracked at every depth: summary, runs/, rounds, triage, gate keys, presence', () => {
  for (const rel of [
    'stardust/replica/gates/all-1440/summary.json',
    'stardust/replica/gates/all-360/runs/20261017-home.json',
    'stardust/replica/gates/all-1440/home/rounds.json',
    'stardust/replica/gates/all-1440/triage.json',
    'stardust/replica/gates/all-1440/home/gate-key.json',
    'stardust/replica/gates/presence.json',
  ]) assert.equal(ignored(rel), false, `${rel} must be tracked`);
});

check('the gate\'s renders and diffs stay untracked (PNG, HTML, triage.md, logs)', () => {
  for (const rel of [
    'stardust/replica/gates/all-1440/home/live.png',
    'stardust/replica/gates/all-1440/home/crop-diff.png',
    'stardust/replica/gates/all-1440/triage.md',
    'stardust/replica/gates/all-1440/home/eds.html',
    'stardust/replica/gates/all-1440/run.log',
  ]) assert.equal(ignored(rel), true, `${rel} must stay ignored`);
});

check('the other heavy folders, run residue and session state stay ignored; replica\'s own records stay tracked', () => {
  for (const rel of ['stardust/current/assets/media/a.json', 'stardust/migrated/assets/x.json', 'stardust/rollout/qa/home.json', 'stardust/.work/x.json', 'stardust/_storage-state.json'])
    assert.equal(ignored(rel), true, `${rel} must stay ignored`);
  for (const rel of ['stardust/replica/progress.json', 'stardust/replica/presence.json', 'stardust/state.json'])
    assert.equal(ignored(rel), false, `${rel} must be tracked`);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nstardust-gitignore: all checks passed');
process.exit(failed ? 1 : 0);
