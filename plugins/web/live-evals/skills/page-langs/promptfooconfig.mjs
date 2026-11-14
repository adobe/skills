import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-langs',
  suiteDir,
  prompt: `Audit the languages of {{url}}: which languages the markup declares, which
languages the body text is actually written in, and where the two disagree.
Save the structured result in ./out/ (relative to your working directory),
then summarize the findings in a few sentences.`,
  contract: `Output format: write ./out/langs.json as {"detected": [{"language": "es", "proportion": 0.7}], "declared": {"htmlLang": "en" or null when the html element has no lang, "nestedLangs": [{"lang": "de", "count": 1}], "hreflang": [{"hreflang": "fr", "href": "..."}]}, "reconciliation": {"agreement": [], "declaredNotDetected": [], "detectedNotDeclared": []}}. "detected" lists the languages of the visible body text as ISO 639-1 codes, most prevalent first. A language counts as declared when it appears in the html lang attribute, a nested lang attribute or an hreflang link (ignore x-default); compare on the primary subtag, so en-US counts as en.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'langsMatchExpected' }],
});
