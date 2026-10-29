#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-layout.test.mjs — figma-gate.mjs from the project copy reskin SKILL.md
// § Setup step 3 builds (stardust/scripts/{reskin,diff,replica,stardust}/): --help, boxes and join run from it,
// and the measure-live and pixel-compare resolvers find their files beside the reskin scripts. Needs
// playwright (prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESKIN = resolve(HERE, '..', '..');
const SKILLS = resolve(RESKIN, '..');
const ROOT_MODULES = resolve(HERE, '..', '..', '..', '..', '..', '..', 'node_modules');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  project-copy layout (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk && existsSync(ROOT_MODULES)) {
  const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-layout-'));
  const p = makeProject(join(scratch, 'proj'));
  const scripts = join(p.dir, 'scripts');
  cpSync(join(RESKIN, 'scripts'), join(scripts, 'reskin'), { recursive: true, filter: (src) => src !== join(RESKIN, 'scripts', 'test') });
  cpSync(join(SKILLS, 'diff', 'scripts'), join(scripts, 'diff'), { recursive: true });
  mkdirSync(join(scripts, 'replica'), { recursive: true });
  for (const f of ['pixel-compare.mjs', 'run-capped.mjs', 'run-bg.mjs']) cpSync(join(SKILLS, 'replica', 'scripts', f), join(scripts, 'replica', f));
  mkdirSync(join(scripts, 'stardust'), { recursive: true });
  cpSync(join(SKILLS, 'stardust', 'scripts', 'state.mjs'), join(scripts, 'stardust', 'state.mjs'));
  symlinkSync(ROOT_MODULES, join(p.root, 'node_modules'));

  const gate = join(scripts, 'reskin', 'figma-gate.mjs');
  const run = (args) => spawnSync(process.execPath, [gate, ...args], { cwd: p.root, encoding: 'utf8' });

  await check('the copy has no test/ directory and every sibling the setup names', () => {
    assert.ok(!existsSync(join(scripts, 'reskin', 'test')));
    for (const f of ['reskin/figma/errors.mjs', 'reskin/figma-gate/join.mjs', 'reskin/render/root-tokens.mjs', 'diff/live-session.mjs', 'diff/measure-live.mjs', 'replica/pixel-compare.mjs', 'stardust/state.mjs']) assert.ok(existsSync(join(scripts, f)), f);
  });

  await check('--help from the copy: exit 0 with the usage', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Usage:/);
  });

  await check('boxes from the copy: one line per included module', () => {
    const r = run(['boxes', '--dir', p.dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^M1 /m);
    assert.match(r.stdout, /^M2 /m);
  });

  await check('the measure-live and pixel-compare resolvers find their files inside the copy', () => {
    const probe = `
      const { loadMeasureLive } = await import(${JSON.stringify(join(scripts, 'reskin', 'figma-gate', 'target.mjs'))});
      const { pixelComparePath } = await import(${JSON.stringify(join(scripts, 'reskin', 'figma-gate', 'pixel.mjs'))});
      const live = await loadMeasureLive();
      console.log(JSON.stringify({ openBrowser: typeof live.openBrowser, compare: pixelComparePath() }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: p.root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const got = JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(got.openBrowser, 'function');
    assert.equal(realpathSync(got.compare), realpathSync(join(scripts, 'replica', 'pixel-compare.mjs')));
  });

  await check('join from the copy: the fixture page joins, exit 0', () => {
    const r = run(['join', '--page', p.slug, '--url', p.page, '--dir', p.dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^PASS join/m);
  });

  rmSync(scratch, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
