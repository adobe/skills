import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-prep',
  suiteDir,
  prompt: `Open {{url}} in your playwright-cli browser and get it ready for a clean screenshot:
get rid of anything that blocks the page (cookie banners, popups, modals). Leave the
page open in that browser when you are done, then summarize what you did in a few sentences.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'overlaysCleared' }],
});
