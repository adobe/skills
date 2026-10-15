#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate.test.mjs — the figma-gate.mjs CLI: --help from an empty cwd
// (exit 0, usage, nothing written), usage errors (exit 2), the boxes subcommand (every included module,
// one root's outline, served from the box cache once nodes.json is gone), a project without a capture
// (exit 2 naming figma-donor.mjs capture), and the --confidential guard. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCurrent } from '../figma/cache.mjs';
import { main } from '../figma-gate.mjs';
import { makeProject, KEY, VERSION } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-cli-'));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
let n = 0;
const project = () => { n += 1; return makeProject(join(scratch, `p${n}`)); };

check('--help from an empty cwd: exit 0, usage, nothing written', () => {
  const cwd = join(scratch, 'empty');
  mkdirSync(cwd);
  const r = run(['--help'], cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage/i);
  for (const s of ['boxes', '--module', '--node', '--depth', '--dir', 'Exit codes', '124']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
  assert.deepEqual(walk(cwd), []);
});

check('an unknown subcommand, no subcommand and boxes --module without a value exit 2', () => {
  const cwd = join(scratch, 'empty');
  assert.equal(run(['frobnicate'], cwd).status, 2);
  assert.equal(run([], cwd).status, 2);
  const r = run(['boxes', '--module'], cwd);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--module needs a value/);
  assert.equal(run(['boxes', '--module', '--depth', '1'], cwd).status, 2);
  assert.equal(run(['boxes', '--module', 'M1', '--node', '1:7'], cwd).status, 2);
  assert.equal(run(['boxes', '--depth', 'x'], cwd).status, 2);
});

check('boxes: one line per included module; --module and --node print an outline', () => {
  const p = project();
  const all = run(['boxes'], p.root);
  assert.equal(all.status, 0, all.stderr);
  const lines = all.stdout.trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(' ')[0]), ['M1', 'M2', 'M3', 'M4']);
  assert.ok(lines[0].startsWith('M1 1:3'), lines[0]);
  assert.ok(lines[1].startsWith('M2 1:7'), lines[1]);
  assert.equal(lines[1], 'M2 1:7 1440×800');
  assert.ok(existsSync(join(p.dir, '.work', 'reskin', 'gates', 'figma-boxes', KEY, `${VERSION}.json`)));
  const one = run(['boxes', '--module', 'M2', '--depth', '1'], p.root);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout.trim().split('\n')[0], '1:7 INSTANCE "Features" 0,0 1440×800 VERTICAL pad 80,120,80,120 gap 32');
  const node = run(['boxes', '--node', 'I1:7;5:7', '--depth', '0'], p.root);
  assert.equal(node.status, 0, node.stderr);
  assert.match(node.stdout, /^I1:7;5:7 FRAME "Card" 0,0 560×240 VERTICAL pad 24,24,24,24 gap 12/);
  const unknown = run(['boxes', '--module', 'M9'], p.root);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /M9/);
  const ghost = run(['boxes', '--node', '9:9'], p.root);
  assert.equal(ghost.status, 2);
  assert.match(ghost.stderr, /9:9/);
});

check('after nodes.json is deleted, boxes --module M2 --depth 1 is served from the box cache', () => {
  const p = project();
  assert.equal(run(['boxes'], p.root).status, 0);
  rmSync(join(p.dir, '.work', 'reskin', 'figma', KEY, VERSION, 'nodes.json'));
  const r = run(['boxes', '--module', 'M2', '--depth', '1'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1:7 INSTANCE "Features"/);
});

check('a project without a capture exits 2 naming figma-donor.mjs capture and the API cost', () => {
  const p = project();
  rmSync(join(p.dir, '.work'), { recursive: true });
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /figma-donor\.mjs capture/);
  assert.match(r.stderr, /API calls/);
});

check('a project without curation-rules.json exits 2 naming the file', () => {
  const p = project();
  rmSync(join(p.dir, 'reskin', 'curation-rules.json'));
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /curation-rules\.json/);
});

check('--confidential (sticky) refuses, writing nothing, when .work/ is not git-ignored', () => {
  const p = project();
  spawnSync('git', ['init', '-q'], { cwd: p.root });
  writeCurrent(p.dir, KEY, VERSION, true);
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\.work\//);
  assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates')));
  writeFileSync(join(p.dir, '.gitignore'), '.work/\nreskin/figma-checks/\n');
  const ok = run(['boxes'], p.root);
  assert.equal(ok.status, 0, ok.stderr);
});

const out = [];
let seen = null;
const code = await main(['boxes', '--module', 'M2'], { log: (m) => out.push(m), warn: () => {}, steps: { boxes: async (args) => { seen = args; return 7; } } });
check('main with steps.boxes replaced returns its code and passes dir and opts', () => {
  assert.equal(code, 7);
  assert.equal(seen.opts.module, 'M2');
  assert.equal(seen.dir, 'stardust');
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
