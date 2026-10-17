#!/usr/bin/env node
// skills/stardust/scripts/test/stardust-gitignore.test.mjs — the stardust/.gitignore template
// (reference/stardust.gitignore) keeps the gate's JSON under replica/gates/ tracked (summary, overrides,
// presence, rounds, triage, probes: the row of record a lost container must not take with it) while the
// gate's images stay ignored. Checked with real git ignore semantics in a temp repo (children get
// HOME=<tmp>, GIT_CONFIG_NOSYSTEM=1 and a ceiling, so no user or system ignore rules leak in):
// `git check-ignore --no-index -q` per path, and the untracked set `git ls-files --others --exclude-standard`
// reports (what `git add` would pick up). The template text carries the three lines in order and no bare
// `replica/gates/` line (git cannot re-include a file whose parent directory is excluded).
// No git on PATH → `skipped: git not found`, exit 0. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'reference', 'stardust.gitignore');

const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) { console.log('skipped: git not found'); process.exit(0); }

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const root = realpathSync(mkdtempSync(join(tmpdir(), 'stardust-gitignore-test-')));
const home = join(root, 'home'); mkdirSync(home);
const repo = join(root, 'repo'); mkdirSync(repo);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root });
const git = (...args) => spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });

const template = readFileSync(TEMPLATE, 'utf8');
const GATE_JSON = [
  'stardust/replica/gates/all-1440/summary.json',
  'stardust/replica/gates/all-1440/overrides.json',
  'stardust/replica/gates/all-1440/presence.json',
  'stardust/replica/gates/all-1440/<slug>/probes.json',
  'stardust/replica/gates/home-1440/rounds.json',
  'stardust/replica/gates/all-360/triage.json',
];
const GATE_PNG = [
  'stardust/replica/gates/all-1440/<slug>/diff.png',
  'stardust/replica/gates/all-1440/<slug>/origin.png',
  'stardust/replica/gates/home-1440/live.png',
];
const OTHER_IGNORED = ['stardust/current/assets/x.png', 'stardust/.work/x.json'];
// `<slug>` is a placeholder; on disk it is a page slug directory.
const onDisk = (p) => p.replace('<slug>', 'a-page');

try {
  const init = git('init', '-q');
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  mkdirSync(join(repo, 'stardust'), { recursive: true });
  writeFileSync(join(repo, 'stardust', '.gitignore'), template);
  for (const p of [...GATE_JSON, ...GATE_PNG, ...OTHER_IGNORED]) {
    const abs = join(repo, onDisk(p));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, p.endsWith('.json') ? '{}\n' : 'png');
  }
  // exit 0 = ignored, 1 = not ignored, anything else = git could not answer
  const ignored = (p) => {
    const r = git('check-ignore', '--no-index', '-q', onDisk(p));
    assert.ok(r.status === 0 || r.status === 1, `git check-ignore ${p} exited ${r.status}: ${r.stderr}`);
    return r.status === 0;
  };

  check('every gate JSON under replica/gates/ is NOT ignored (summary, overrides, presence, probes, rounds, triage)', () => {
    for (const p of GATE_JSON) assert.equal(ignored(p), false, `${p} must be tracked`);
  });

  check('every gate image under replica/gates/ IS ignored', () => {
    for (const p of GATE_PNG) assert.equal(ignored(p), true, `${p} must stay untracked`);
  });

  check('current/assets/x.png and .work/x.json stay ignored', () => {
    for (const p of OTHER_IGNORED) assert.equal(ignored(p), true, `${p} must stay untracked`);
  });

  check('git add would pick up exactly .gitignore and the gate JSON (ls-files --others --exclude-standard)', () => {
    const r = git('ls-files', '--others', '--exclude-standard');
    assert.equal(r.status, 0, r.stderr);
    const listed = r.stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(listed, ['stardust/.gitignore', ...GATE_JSON.map(onDisk)].sort());
  });

  check('the template carries the three replica/gates lines in order and no bare replica/gates/ line', () => {
    const lines = template.split('\n').map((l) => l.trim());
    const at = lines.indexOf('replica/gates/**');
    assert.ok(at >= 0, 'missing `replica/gates/**`');
    assert.deepEqual(lines.slice(at, at + 3), ['replica/gates/**', '!replica/gates/**/', '!replica/gates/**/*.json']);
    assert.ok(!lines.includes('replica/gates/'), 'a bare `replica/gates/` line excludes the directory, and git cannot re-include a file below it');
    assert.ok(lines[at - 1].startsWith('#'), 'a one-line comment sits right above the three lines');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failing` : '\nstardust-gitignore: all checks passed');
process.exit(failed ? 1 : 0);
