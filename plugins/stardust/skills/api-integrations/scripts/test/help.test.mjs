import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const scripts = ['api-static-scan', 'api-detect', 'api-contracts', 'api-cors', 'api-codegen', 'api-check'];
const repoRoot = resolve('.');
const scratchRoot = await mkdtemp(join(tmpdir(), 'api-integrations-help-'));

test('CLI help exits cleanly and writes nothing', async (t) => {
  t.after(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });
  for (const script of scripts) {
    const cwd = await mkdtemp(join(scratchRoot, `${script}-`));
    try {
      const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', `${script}.mjs`), '--help'], {
        cwd,
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, `${script} --help should exit 0; stderr: ${result.stderr}`);
      assert.ok(result.stdout.startsWith(`${script}.mjs —`), `${script} help header should start with script name`);
      assert.deepEqual(await readdir(cwd), [], `${script} --help should not write to cwd`);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});
