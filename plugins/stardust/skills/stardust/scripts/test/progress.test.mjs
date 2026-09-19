#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/progress.mjs — the batch-driver completion contract.
 * Run: node skills/stardust/scripts/test/progress.test.mjs   (exit 1 on failure)
 *   - createProgress writes the JSON shape atomically and tick() counts ok / failed / noverdict;
 *   - summaryLine renders `SUMMARY <driver> ok= failed= [noverdict=] exit= details= k=v`, noverdict never in failed;
 *   - `read <file>` prints one line and exits 0; a missing file exits 1; --help exits 0.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgress, summaryLine, defaultProgressFile } from '../progress.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'progress.mjs');
const dir = mkdtempSync(join(tmpdir(), 'progress-'));
try {
  assert.equal(defaultProgressFile('deploy', 'deploy-batch'), join('stardust', '.work', 'deploy', 'deploy-batch.progress.json'));

  const file = join(dir, 'nested', 'x.progress.json');
  const p = createProgress({ file, driver: 'gate-batch', total: 3, extra: { publish: false } });
  let s = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([s.driver, s.total, s.done, s.ok, s.failed, s.noverdict, s.publish], ['gate-batch', 3, 0, 0, 0, 0, false], 'initial shape written at create');
  p.tick({ ok: true, path: '/a' });
  p.tick({ ok: false, path: '/b' });
  p.tick({ noverdict: true, path: '/c' });
  s = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([s.done, s.ok, s.failed, s.noverdict, s.lastPath], [3, 1, 1, 1, '/c'], 'ticks counted; a deadline is noverdict, not failed');
  assert.ok(s.updatedAt >= s.startedAt);
  assert.deepEqual(readdirSync(join(dir, 'nested')), ['x.progress.json'], 'no tmp file left behind (rename)');
  assert.equal(p.summaryLine({ exit: 124, details: 'out/table.md', extra: { pairs: 3, note: 'two words' } }), 'SUMMARY gate-batch ok=1 failed=1 noverdict=1 exit=124 details=out/table.md pairs=3 note=two_words');
  assert.equal(summaryLine({ driver: 'verify', ok: 5, exit: 0, details: 'x.json' }), 'SUMMARY verify ok=5 failed=0 exit=0 details=x.json', 'noverdict omitted when 0');
  const quiet = createProgress({ file: null, driver: 'q', total: 1 });
  quiet.tick({ ok: true });
  assert.equal(quiet.summaryLine({ exit: 0 }), 'SUMMARY q ok=1 failed=0 exit=0 details=-', 'file: null still summarises');

  let r = spawnSync(process.execPath, [CLI, 'read', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^gate-batch 3\/3 ok=1 failed=1 noverdict=1 last=\/c updated \d+s ago$/m);
  r = spawnSync(process.execPath, [CLI, 'read', join(dir, 'missing.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'missing file exits 1');
  r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage:/);
  console.log('progress test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
