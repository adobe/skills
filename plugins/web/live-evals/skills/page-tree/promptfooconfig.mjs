import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildConfig } from '../../lib/config.mjs';

const suiteDir = dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  skill: 'page-tree',
  suiteDir,
  prompt: `{{task}}
Page: {{url}}
Use ./out/ (relative to your working directory) for every file, then summarize in a few sentences.`,
  contract: `Output format: tree.txt is the visible layout as an indented tree, one element per line: ID [role] [CxR] [bg:type] @x,y WxH "first 30 characters of text". The root (body) is r, its children rc1, rc2, ..., their children rc2c1, and so on. Show [role] only for elements with an ARIA role, [CxR] (columns x rows) only for multi-column grids, and [bg:color], [bg:gradient] or [bg:image] only for visually distinct backgrounds. Positions are page coordinates in px. Include only elements at least 900px wide unless I ask for narrower ones; position:fixed elements are always included, as direct children of the root. nodemap.json maps every ID in the tree to {"selector": "<CSS selector>", "background": {"type", "value"}} (background only when shown).`,
  tests: parse(readFileSync(join(suiteDir, 'cases.yaml'), 'utf-8')),
  assert: [{ file: 'assert.mjs', fn: 'treeMatches' }],
});
