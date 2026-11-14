import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'site-scan',
  suiteDir,
  prompt: `{{task}}
Site: {{url}}
Save everything the work produces in ./out/ (relative to your working directory),
then summarize what you found in a few sentences.`,
  contract: `Output format: ./out/urls.json {"valid": number, "urls": [{"url": "...", "lang": "fr-FR" or ""}], "errors": [{"url": "...", "message": "..."}]}, where urls holds only the URLs kept after your filters, lang is the language tag in the URL path (empty when there is none) and errors lists every sitemap or page that could not be fetched.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'scanMatches' }],
});
