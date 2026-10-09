#!/usr/bin/env node
// skills/qa/scripts/test/chrome-check.test.mjs — the qa `chrome` check: without a header contract it reports one info
// finding and launches nothing; with one, the comparer and its decisions are diff's (chrome-compare.test.mjs, and
// chrome-explore.test.mjs for the browser run).
// Run: node plugins/stardust/skills/qa/scripts/test/chrome-check.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../checks/chrome.mjs';

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

await check('no contract: one header-contract-missing info finding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-chrome-'));
  const f = await run({ base: 'https://example.com', opts: { headerContract: join(dir, 'none.json'), outDir: dir } });
  assert.deepEqual(f.map((x) => [x.check, x.id, x.severity]), [['chrome', 'header-contract-missing', 'info']]);
  rmSync(dir, { recursive: true });
});
process.exit(failed ? 1 : 0);
