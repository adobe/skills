#!/usr/bin/env node
// Fixture test: the cross-plugin path probe — `impeccable-version-check.mjs
// --probe/--state` and `script-paths.mjs --installed` — against file-name
// trees of two shipped impeccable layouts (4.1.3: legacy scripts; 4.3.1:
// launcher) and one hypothetical drifted layout, all under
// lint/fixtures/impeccable-layout/, so the resolver is testable offline
// (CI has no impeccable installed).
//
// Pins:
//   * probe line shape "impeccable <v> at <skillDir> — launcher <x>, <n> commands, <k> drift"
//   * launcher detection: scripts/impeccable (4.3) vs scripts/hook-admin.mjs (4.1); 0 drift on both
//   * --local takes the plugin root or the skill dir itself (manifest two levels up, else "unknown")
//   * drift layout: one "drift: … missing" line per lost load-bearing entry; exit still 0 (A35)
//   * --state: state.json#impeccable written with the consumer's key names
//     (skillDir, launcher, version, registryCommands, probedAt, drift), other keys preserved,
//     an unparsable state file left untouched; --no-probe writes nothing; --help exits 0
//   * lint: docs-fail yields exactly the four cite forms (npx, renamed reference, unknown
//     launcher verb, unknown $impeccable command) and honours `script-paths: ignore`;
//     exit 0 advisory, exit 1 under --strict, exit 2 with no install dir
//   * lint: docs-pass is clean on 4.3.1 and reports only the launcher on 4.1.3
//   * lint: the real skills/ tree resolves against the 4.3.1 layout (the sweep stays swept)
//
// Usage: node plugins/stardust/evals/lint/impeccable-probe-fixtures.mjs   (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const HERE = import.meta.dirname;
const FX = join(HERE, 'fixtures', 'impeccable-layout');
const CHECK = join(HERE, '..', '..', 'skills', 'stardust', 'scripts', 'impeccable-version-check.mjs');
const LINT = join(HERE, 'script-paths.mjs');
const run = (script, ...a) => { const r = spawnSync(process.execPath, [script, ...a], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } }); return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr }; };
const tmp = mkdtempSync(join(os.tmpdir(), 'impeccable-probe-'));
let n = 0;
const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`impeccable-probe fixtures: FAIL ${name}\n${e.message}`); process.exit(1); } };

// ── version-check --probe ────────────────────────────────────────────────────
t('help exits 0', () => { const r = run(CHECK, '--help'); assert.equal(r.code, 0); assert.match(r.out, /--state <file>/); });
t('4.3.1 layout: launcher, 23 commands, 0 drift', () => {
  const r = run(CHECK, '--local', join(FX, '4.3.1'), '--offline');
  assert.equal(r.code, 0);
  assert.match(r.out, /^impeccable 4\.3\.1 at .*4\.3\.1\/skills\/impeccable — launcher scripts\/impeccable, 23 commands, 0 drift$/m);
  assert.doesNotMatch(r.out, /^drift:/m);
});
t('--local accepts the skill dir itself: same probe line as the plugin root', () => {
  const root = run(CHECK, '--local', join(FX, '4.3.1'), '--offline').out.split('\n').find((l) => / at /.test(l));
  const skill = run(CHECK, '--local', join(FX, '4.3.1', 'skills', 'impeccable'), '--offline').out.split('\n').find((l) => / at /.test(l));
  assert.ok(root && skill, 'both forms print a probe line');
  assert.equal(skill, root);
  // a bare skill dir with no manifest anywhere: version "unknown", probe still runs, state records skillDir
  const bare = join(tmp, 'bare', 'skills', 'impeccable'); cpSync(join(FX, '4.3.1', 'skills', 'impeccable'), bare, { recursive: true });
  const state = join(tmp, 'bare-state.json');
  const r = run(CHECK, '--local', bare, '--offline', '--state', state);
  assert.equal(r.code, 0);
  assert.match(r.out, /^impeccable unknown at .*bare\/skills\/impeccable — launcher scripts\/impeccable, 23 commands, 0 drift$/m);
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).impeccable.skillDir, bare);
});
t('4.1.3 layout: legacy hook-admin.mjs launcher, 0 drift', () => {
  const r = run(CHECK, '--local', join(FX, '4.1.3'), '--offline');
  assert.equal(r.code, 0);
  assert.match(r.out, /^impeccable 4\.1\.3 at .* — launcher scripts\/hook-admin\.mjs, 23 commands, 0 drift$/m);
});
t('drift layout: one line per missing load-bearing entry, exit 0', () => {
  const r = run(CHECK, '--local', join(FX, 'drift'), '--offline');
  assert.equal(r.code, 0, 'advisory: exit 0 even with drift');
  assert.match(r.out, /^impeccable 9\.9\.9 at .* — no launcher, 0 commands, 3 drift$/m);
  assert.match(r.out, /^drift: scripts\/impeccable missing/m);
  assert.match(r.out, /^drift: scripts\/command-metadata\.json missing$/m, 'an array registry is not a registry');
  assert.match(r.out, /^drift: reference\/document\.md missing$/m);
  assert.doesNotMatch(r.out, /^drift: reference\/init\.md/m);
  const j = JSON.parse(run(CHECK, '--local', join(FX, 'drift'), '--offline', '--json').out);
  assert.equal(j.launcher, null); assert.equal(j.registryCommands, null); assert.equal(j.drift.length, 3);
});
t('--state merges state.json#impeccable and preserves other keys', () => {
  const state = join(tmp, 'stardust', 'state.json');
  writeFileSync(join(tmp, 'seed.json'), '');
  const r = run(CHECK, '--local', join(FX, '4.3.1'), '--offline', '--state', state);
  assert.equal(r.code, 0);
  let s = JSON.parse(readFileSync(state, 'utf8'));
  assert.ok(s.impeccable.skillDir.endsWith(join('4.3.1', 'skills', 'impeccable')), 'skillDir is the skill dir, not the plugin root');
  assert.deepEqual(Object.keys(s.impeccable).sort(), ['drift', 'launcher', 'probedAt', 'registryCommands', 'skillDir', 'version']);
  assert.equal(s.impeccable.launcher, 'scripts/impeccable'); assert.equal(s.impeccable.version, '4.3.1'); assert.equal(s.impeccable.registryCommands, 23); assert.deepEqual(s.impeccable.drift, []);
  assert.match(s.impeccable.probedAt, /^\d{4}-\d{2}-\d{2}T/);
  writeFileSync(state, JSON.stringify({ site: { originUrl: 'https://example.com' }, impeccable: { skillDir: '/old', version: '4.1.3' }, pages: [] }));
  run(CHECK, '--local', join(FX, '4.1.3'), '--offline', '--state', state);
  s = JSON.parse(readFileSync(state, 'utf8'));
  assert.equal(s.site.originUrl, 'https://example.com'); assert.deepEqual(s.pages, []);
  assert.equal(s.impeccable.launcher, 'scripts/hook-admin.mjs'); assert.ok(s.impeccable.skillDir.includes('4.1.3'), 'refreshed, not kept');
});
t('--state never overwrites an unparsable file; --no-probe writes nothing', () => {
  const bad = join(tmp, 'bad.json'); writeFileSync(bad, '{ not json');
  const r = run(CHECK, '--local', join(FX, '4.3.1'), '--offline', '--state', bad);
  assert.equal(r.code, 0); assert.match(r.out, /state not written/); assert.equal(readFileSync(bad, 'utf8'), '{ not json');
  const none = join(tmp, 'none.json');
  const r2 = run(CHECK, '--local', join(FX, '4.3.1'), '--offline', '--no-probe', '--state', none);
  assert.equal(r2.code, 0); assert.doesNotMatch(r2.out, / at /); assert.equal(existsSync(none), false);
});

// ── script-paths --installed ─────────────────────────────────────────────────
const L431 = join(FX, '4.3.1', 'skills', 'impeccable');
const L413 = join(FX, '4.1.3', 'skills', 'impeccable');
t('lint help exits 0; no install dir exits 2', () => {
  assert.equal(run(LINT, '--help').code, 0);
  const r = run(LINT, '--installed', join(FX, 'nowhere'), '--docs', join(FX, 'docs-pass'));
  assert.equal(r.code, 2); assert.match(r.err, /no impeccable skill directory/);
});
t('docs-fail: the four drift forms, ignore honoured, advisory exit 0', () => {
  const r = run(LINT, '--installed', L431, '--docs', join(FX, 'docs-fail'));
  assert.equal(r.code, 0, `advisory exit: ${r.all}`);
  const lines = r.err.split('\n').filter((l) => /notes\.md:\d+:/.test(l));
  assert.equal(lines.length, 4, r.err);
  assert.match(r.err, /notes\.md:3: npx impeccable → `npx impeccable …` is not a form/);
  assert.match(r.err, /notes\.md:4: .*reference\/teach\.md does not exist/);
  assert.match(r.err, /notes\.md:5: scripts\/impeccable load-context → .*"load-context" is neither a registry command nor a launcher verb/);
  assert.match(r.err, /notes\.md:6: \$impeccable teach → .*"teach" is not in/);
  assert.doesNotMatch(r.err, /notes\.md:7:/, 'resolving cites are silent');
  assert.doesNotMatch(r.err, /notes\.md:8:/, 'script-paths: ignore honoured');
  assert.match(r.err, /5 impeccable cites checked|[5-9] impeccable cites checked/);
});
t('docs-fail --strict exits 1; GITHUB_ACTIONS emits ::warning annotations', () => {
  assert.equal(run(LINT, '--installed', L431, '--docs', join(FX, 'docs-fail'), '--strict').code, 1);
  const r = spawnSync(process.execPath, [LINT, '--installed', L431, '--docs', join(FX, 'docs-fail')], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(r.status, 0); assert.equal((r.stdout.match(/^::warning file=.*,line=\d+::impeccable drift:/gm) || []).length, 4);
});
t('docs-pass: clean on 4.3.1, launcher-only finding on 4.1.3', () => {
  const ok = run(LINT, '--installed', L431, '--docs', join(FX, 'docs-pass'), '--strict');
  assert.equal(ok.code, 0, ok.all); assert.match(ok.out, /impeccable cites checked .* — all resolve/);
  const old = run(LINT, '--installed', L413, '--docs', join(FX, 'docs-pass'));
  assert.equal(old.code, 0);
  const lines = old.err.split('\n').filter((l) => /notes\.md:\d+:/.test(l));
  assert.ok(lines.length >= 1 && lines.every((l) => /scripts\/impeccable launcher does not exist .*older install: scripts\/hook-admin\.mjs/.test(l)), old.err);
});
t('real skills/ tree resolves against the 4.3.1 layout', () => {
  const r = run(LINT, '--installed', L431, '--strict');
  assert.equal(r.code, 0, `stardust docs cite an impeccable path/command the 4.3.1 layout lacks:\n${r.all}`);
  assert.match(r.out, /(\d+) impeccable cites checked/);
  assert.ok(Number(r.out.match(/(\d+) impeccable cites checked/)[1]) >= 50, 'the extractor still sees the docs');
});

rmSync(tmp, { recursive: true, force: true });
console.log(`impeccable-probe fixtures: ${n} checks pass (4.1.3 / 4.3.1 / drift layouts, docs-fail / docs-pass, real tree)`);
