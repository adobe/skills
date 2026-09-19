#!/usr/bin/env node
/**
 * Fixture test: deploy-batch.mjs persistence and drive-order defects (B2 remediation, defects 3 + 4).
 * Run: node skills/deploy/scripts/test/deploy-batch-persist.test.mjs   (exit 1 on failure)
 *
 *   - serialPersister: a rejected write reaches only its own awaiter; the NEXT call still runs
 *     (before the fix the chain stayed rejected and every later persist was skipped);
 *   - walkHtml: pages come back in webPath order whatever order readdir yields
 *     (before the fix the drive order was the filesystem's — APFS-sorted, ext4 arbitrary);
 *   - end to end against mock-da.mjs: the ledger file is corrupted during the 5th page's verify
 *     (the checkpoint at done=5 rejects) and restored during the 6th — the run WARNs, keeps
 *     driving and its final write holds all six rows (before the fix: fatal exit 2, no fresh write).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';
import { serialPersister, walkHtml } from '../deploy-batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-batch.mjs');
const page = (t) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p></div></main><footer></footer></body>\n`;

const dir = mkdtempSync(join(tmpdir(), 'deploy-batch-persist-'));
const content = join(dir, 'content');
mkdirSync(join(content, 'sub'), { recursive: true });
const ledgerPath = join(content, '.deploy-ledger.json');

try {
  // 1. serialPersister — one rejection must not poison the chain
  let calls = 0;
  const persist = serialPersister(async () => { calls += 1; if (calls === 1) throw new Error('disk full'); return calls; });
  await assert.rejects(persist(), /disk full/, 'the failing write rejects its own awaiter');
  assert.equal(await persist(), 2, 'the next persist runs (was: skipped, rejected with the stale error)');
  assert.equal(await persist(), 3, 'and the chain stays live');

  // 2. walkHtml — deterministic order under a reversed readdir
  for (const n of ['a', 'c', 'e']) writeFileSync(join(content, `${n}.html`), page(n));
  writeFileSync(join(content, 'sub', 'b.html'), page('b'));
  const reversed = async (d) => (await readdir(d)).sort().reverse();
  const pages = await walkHtml(content, content, reversed);
  assert.deepEqual(pages.map((p) => p.webPath), ['/a', '/c', '/e', '/sub/b'], 'webPath order, not readdir order');
  assert.deepEqual((await walkHtml(content)).map((p) => p.webPath), ['/a', '/c', '/e', '/sub/b'], 'default readdir gives the same order');

  // 3. end to end — a checkpoint failure mid-run is a WARN, not a fatal exit; the final write lands every row
  rmSync(join(content, 'sub'), { recursive: true, force: true });
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) writeFileSync(join(content, `${n}.html`), page(n));
  const mock = await startMock();
  try {
    mock.rules.delivered = (tld, p) => {
      if (p === '/e') writeFileSync(ledgerPath, '{ not json'); // the persist at done=5 re-reads this → rejects
      if (p === '/f') writeFileSync(ledgerPath, '{}'); // restored before the final write
      return { status: 200, body: '<main><h1>ok</h1></main>' };
    };
    const r = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, '--org', 'o', '--repo', 'r', '--branch', 'main', '--content', content, '--concurrency', '1', '--no-progress'], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', ...mock.env() } });
      let stdout = ''; let stderr = '';
      c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
      const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 30000);
      c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
    });
    assert.equal(r.status, 0, `checkpoint failure is not fatal: ${r.stderr}`);
    assert.match(r.stderr, /WARN ledger checkpoint failed \(ledger .* is not valid JSON/, 'the failed checkpoint is reported');
    assert.match(r.stderr, /done\. 6 ok, 0 failed\./);
    const led = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.equal(Object.keys(led).length, 6, 'the final write holds every driven row');
    assert.ok(Object.values(led).every((x) => x.status === 'previewed'));
    assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, 6, 'all six pages driven, in order');
    assert.deepEqual(mock.requests.filter((q) => q.method === 'PUT').map((q) => q.url.replace(/^\/da\/o\/r/, '')), ['/a.html', '/b.html', '/c.html', '/d.html', '/e.html', '/f.html'], 'webPath drive order');
  } finally {
    await mock.close();
  }
  console.log('deploy-batch-persist test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
