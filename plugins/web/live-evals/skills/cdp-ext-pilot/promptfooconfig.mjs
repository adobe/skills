import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));
const root = join(suiteDir, '../..');
const extension = join(root, 'fixtures/ext-notes');

export default buildConfig({
  skill: 'cdp-ext-pilot',
  suiteDir,
  prompt: `The unpacked Chrome extension is in ${extension}.
{{task}}
Put any files in ./out/ (relative to your working directory), then answer briefly.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'extensionTaskDone' }],
  extensions: [`file://${join(suiteDir, 'hooks.mjs')}:extensionHook`],
  siblings: ['cdp-connect'],
  concurrency: 1, // the CLI's extension browser exposes one debugging port at a time
  timeoutS: 150,
});
