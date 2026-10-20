import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'cdp-connect',
  suiteDir,
  prompt: `Chrome is already running with remote debugging on port 9222. Use it.
{{task}}
Put any files in ./out/ (relative to your working directory), then answer briefly.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'cdpTaskDone' }],
  extensions: [`file://${join(suiteDir, 'hooks.mjs')}:extensionHook`],
  concurrency: 1, // all runs share the one Chrome on port 9222
});
