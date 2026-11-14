import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-reduce',
  suiteDir,
  prompt: `{{task}}
Page: {{url}}
Use ./out/ (relative to your working directory) for every file, then summarize in a few sentences.`,
  contract: `Output format: skeleton.html has one block per page section: the navigation or header, each section element of main, and the footer. Each block is preceded by a comment <!-- section:INDEX type:TYPE xpath:XPATH --> (INDEX from 0). Keep the markup structure but remove scripts, styles, tracking and utility class names, and replace content with tokens: {TEXT}, {HEADING:n}, {IMAGE:WxH}, {LINK:label}, {CTA:label} (a button-like link). When 3 or more consecutive siblings are structurally identical, keep two and add {REPEAT:N} for the remaining N. manifest.json is {"url", "title", "generatedAt", "sections": [{"index", "type", "xpath"}]}.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'reduceMatches' }],
});
