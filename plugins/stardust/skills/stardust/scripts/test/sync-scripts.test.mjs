#!/usr/bin/env node
// skills/stardust/scripts/test/sync-scripts.test.mjs — sync-scripts.mjs on a fake skill tree (a loose
// install: the sixteen stardust skills beside a foreign one): byte-identical copies with modes kept,
// test/ skipped, foreign skills ignored, VERSION written, idempotent, --check drift, stale extras
// reported and kept, an incomplete tree refused. Pure filesystem; no browser. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS } from '../sync-scripts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'sync-scripts-'));
const tree = join(root, '.agents', 'skills');
const project = join(root, 'project');
mkdirSync(project, { recursive: true });
const put = (p, body, mode) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); if (mode) chmodSync(p, mode); };
for (const s of [...SKILLS, 'someone-elses']) put(join(tree, s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
put(join(tree, 'stardust', 'VERSION'), '9.8.7\n');
put(join(tree, 'stardust', 'scripts', 'sync-scripts.mjs'), readFileSync(join(HERE, '..', 'sync-scripts.mjs')));
put(join(tree, 'diff', 'scripts', 'visual-diff.mjs'), 'export const a = 1;\n', 0o755);
put(join(tree, 'qa', 'scripts', 'checks', 'chrome.mjs'), 'export const b = 2;\n');
put(join(tree, 'qa', 'scripts', 'test', 'chrome.test.mjs'), 'test\n');
put(join(tree, 'someone-elses', 'scripts', 'x.mjs'), 'nope\n');
const SYNC = join(tree, 'stardust', 'scripts', 'sync-scripts.mjs');
const run = (...a) => { const r = spawnSync(process.execPath, [SYNC, ...a], { cwd: project, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const dest = (...p) => join(project, 'stardust', 'scripts', ...p);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('--help prints usage and writes nothing', () => {
  const r = run('--help');
  assert.equal(r.code, 0); assert.match(r.out, /sync-scripts\.mjs/); assert.equal(existsSync(dest()), false);
});

check('first run copies stardust scripts byte-identical, keeps modes, skips test/ and foreign skills, writes VERSION', () => {
  const r = run();
  assert.equal(r.code, 0, r.err); assert.match(r.out, /3 copied, 0 unchanged, version 9\.8\.7/);
  assert.equal(readFileSync(dest('diff', 'visual-diff.mjs'), 'utf8'), 'export const a = 1;\n');
  assert.equal(statSync(dest('diff', 'visual-diff.mjs')).mode & 0o777, 0o755);
  assert.ok(existsSync(dest('qa', 'checks', 'chrome.mjs')));
  assert.equal(existsSync(dest('qa', 'test')), false);
  assert.equal(existsSync(dest('someone-elses')), false);
  assert.equal(readFileSync(dest('VERSION'), 'utf8'), '9.8.7\n');
});

check('second run is a no-op; --check passes', () => {
  assert.match(run().out, /0 copied, 3 unchanged/);
  const c = run('--check'); assert.equal(c.code, 0); assert.match(c.out, /in sync with stardust 9\.8\.7 \(3 files\)/);
});

check('--check reports an edited copy, a missing copy and a version bump without writing; a sync repairs them', () => {
  writeFileSync(dest('diff', 'visual-diff.mjs'), 'edited\n');
  rmSync(dest('qa', 'checks', 'chrome.mjs'));
  put(join(tree, 'stardust', 'VERSION'), '9.9.0\n');
  const c = run('--check');
  assert.equal(c.code, 1);
  assert.match(c.out, /differs {2}stardust\/scripts\/diff\/visual-diff\.mjs/);
  assert.match(c.out, /missing {2}stardust\/scripts\/qa\/checks\/chrome\.mjs/);
  assert.match(c.out, /version {3}stardust\/scripts\/VERSION 9\.8\.7 → 9\.9\.0/);
  assert.equal(readFileSync(dest('diff', 'visual-diff.mjs'), 'utf8'), 'edited\n');
  assert.match(run().out, /2 copied/);
  assert.equal(run('--check').code, 0);
});

check('a copy stardust no longer ships is reported and left in place', () => {
  put(dest('diff', 'retired.mjs'), 'old\n');
  const r = run();
  assert.match(r.out, /not shipped by stardust 9\.9\.0 \(left in place\): stardust\/scripts\/diff\/retired\.mjs/);
  assert.ok(existsSync(dest('diff', 'retired.mjs')));
});

check('--project writes elsewhere; a missing value is a usage error', () => {
  const other = join(root, 'other');
  const r = spawnSync(process.execPath, [SYNC, '--project', other], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.ok(existsSync(join(other, 'stardust', 'scripts', 'VERSION')));
  assert.equal(run('--project').code, 2);
});

check('an incomplete skill tree exits 2 naming the missing skills', () => {
  rmSync(join(tree, 'spec'), { recursive: true });
  const r = run();
  assert.equal(r.code, 2); assert.match(r.err, /lacks spec/);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nsync-scripts: all checks passed');
process.exit(failed ? 1 : 0);
