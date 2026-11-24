import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPTS, tree } from './lib/testing.mjs';

// The review workflow runs its scripts from a copy outside the checkout. On a runner
// whose temporary directory is reached through a symbolic link, a script compared
// process.argv[1] with import.meta.url, found them different and did nothing, with exit 0.
test('a script started through a symbolic link still runs', (t) => {
  const real = mkdtempSync(join(tmpdir(), 'skills-real-'));
  const links = mkdtempSync(join(tmpdir(), 'skills-links-'));
  t.after(() => { rmSync(real, { recursive: true, force: true }); rmSync(links, { recursive: true, force: true }); });
  cpSync(SCRIPTS, join(real, 'scripts'), { recursive: true });
  symlinkSync(join(real, 'scripts'), join(links, 'scripts'));
  const root = tree(t, { 'plugins/a/.claude-plugin/plugin.json': '{}' });
  for (const [script, args] of [['check-plugins.mjs', ['codeowners']], ['check-commits.mjs', ['x', 'y']], ['tessl-review.mjs', ['missing.txt']], ['check-skills.mjs', ['--list', 'no-such-rule']]]) {
    const result = spawnSync(process.execPath, [join(links, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${script} did nothing: it exited 0 without a tree it could pass on`);
  }
});
