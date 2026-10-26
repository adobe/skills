import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'browser-probe',
  suiteDir,
  prompt: `Our headless Chrome automation (playwright-cli) needs to load {{url}}.
Find out whether bot protection is getting in the way and, if so, set up
what our playwright-cli tooling needs to load the page (it reads a
\`recipe.json\`). Put every output file in ./out/ (relative to your
working directory). Then summarize in a few sentences.`,
  contract: `Output format: write ./out/recipe.json as {"probe": [{"url": "<the url>", "config": {"browserName": "chromium", "launchOptions": {"channel": "chrome" only if the system Chrome is needed, "args": [...] only if needed}}, "persistent": true only if a persistent profile is needed, "stealth": true only if the JavaScript stealth patches (hiding navigator.webdriver) are needed}]}. config must be a valid playwright-cli browser config. Write the recipe even when the plain headless browser already works.`,
  tests: parse(readFileSync(join(suiteDir, 'sites.yaml'), 'utf-8')),
  assert: [
    { file: 'assert-live.mjs', fn: 'reportAndRecipeConsistent' },
    { file: 'assert-live.mjs', fn: 'recipeLoadsPage' },
    { file: 'assert-live.mjs', fn: 'matchesExpectedTier', weight: 0 },
  ],
  // Without the skill there is no probe report to compare with: judge the outcome, the recipe loads the page.
  assertNoSkill: [{ file: 'assert-live.mjs', fn: 'recipeLoadsPage' }],
});
