#!/usr/bin/env node
// Renders the stored results as promptfoo reports (no model calls, nothing written to promptfoo's db):
//   REPORT-detail.html  one row per case, one column per model (promptfoo's own report layout)
// The one-page gist is REPORT.html, written by scripts/gist-report.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/results.mjs';

for (const [level, file] of [['case', 'REPORT-detail.html']]) {
  const out = join(root, file);
  // promptfoo exits non-zero when cells fail; a model below its floor is a result, not an error.
  spawnSync('npx', ['promptfoo', 'eval', '-c', join(root, 'lib/report-config.mjs'), '--no-write', '--no-cache', '--no-table', '--no-progress-bar', '-o', out], {
    cwd: root,
    env: { ...process.env, REPORT_LEVEL: level },
    stdio: 'ignore',
  });
  if (!existsSync(out) || statSync(out).size < 10_000) throw new Error(`promptfoo did not write ${file}`);
  console.log(`${file} written`);
}
