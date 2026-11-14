import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-collect',
  suiteDir,
  prompt: `{{task}}
Page: {{url}}
Save everything the work produces in ./out/ (relative to your working directory),
then summarize what you found in a few sentences.`,
  contract: `Output format, all under ./out/: metadata.json {"title", "tags": {"description": "...", "og:title": "..."} (meta name or property to content), "canonical", "structuredData": [parsed JSON-LD objects]}; forms.json {"forms": [{"action", "method", "id", "fields": [{"tag", "type", "name", "required", "label"}]}]}; videos.json {"videos": [{"type": "native" or "embed", "src", "poster", "sources"}]}; socials.json {"socials": [{"platform", "url"}]}; text.json {"headings": [], "wordCount": 0}; icons.json {"icons": [{"name", "class": "icon" or "logo", "source", "file": "icons/<name>.svg"}]} with each SVG saved as ./out/icons/<name>.svg. Icons are SVGs of at most 48px inside buttons, links or nav (class icon), plus the brand logo (class logo); take them from inline svg, svg images, sprite <use> references and CSS backgrounds. Name each from its aria-label in lower case, otherwise icon-N. Clean every SVG: remove xml declarations and comments, keep a viewBox, drop width and height, and for icons (not logos) replace fill and stroke colors with currentColor.`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'collectMatches' }],
});
