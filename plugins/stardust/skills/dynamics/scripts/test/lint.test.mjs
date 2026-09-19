#!/usr/bin/env node
/**
 * Fixture test for `dynamics-plan.mjs --lint <inventory.md> <plan.md>` (no network).
 * Run: node skills/dynamics/scripts/test/lint.test.mjs
 *
 * The lint is the rollout B2 instrument behind triage.md's plan format: every
 * inventory row `| N |` is placed exactly once in the plan as a list item
 * `- #N …`; `#N` tokens in prose (an issue or PR reference) are not rows.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'dynamics-plan.mjs');
const dir = mkdtempSync(join(tmpdir(), 'dynamics-lint-'));
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); };
const lint = (inventory, plan) => {
  const a = join(dir, 'inventory.md'); const b = join(dir, 'plan.md');
  writeFileSync(a, inventory); writeFileSync(b, plan);
  const r = spawnSync(process.execPath, [script, '--lint', a, b], { encoding: 'utf8' });
  return { code: r.status, problems: (r.stderr.match(/^ {2}- /gm) || []).length, err: r.stderr };
};

// an inventory with two tables that both number from 1 (§ Features, § Register) — ids are a set, not a list
const inventory = `# Dynamic features
| # | id | class | feature |
|---|---|---|---|
| 1 | search | S | site search form |
| 2 | modal | M | contact modal |
| 3 | player | V | video pill |

## Register (decided-out)
| # | feature | reason |
|---|---|---|
| 2 | shortlist | session-bound |
`;

const placed = lint(inventory, `## Phases\n- **search** — 1\n  - #1 site search form (S)\n- **modal** — 1\n  - #2 contact modal (M)\n- **media** — 1\n  - #3 video pill (V)\n`);
eq('every row placed once → exit 0', [placed.code, placed.problems], [0, 0]);
const missAndDup = lint(inventory, `- #1 search\n- #2 modal\n* #2 modal again\n`);
eq('row missing + row twice → exit 1, two problems', [missAndDup.code, missAndDup.problems], [1, 2]);
eq('missing row named', /row 3 is not placed/.test(missAndDup.err) && /row 2 appears 2×/.test(missAndDup.err), true);
const orphan = lint(inventory, `- #1 a\n- #2 b\n- #3 c\n- #9 nothing in the inventory\n`);
eq('orphan #9 → exit 1, one problem', [orphan.code, orphan.problems], [1, 1]);
eq('prose #42 (issue ref) is not an orphan', lint(inventory, `See adobe/skills#42 and PR #7 for context.\n\n- #1 a\n- #2 b\n- #3 c\n`).code, 0);
eq('#N inside a list item text is not a second placement', lint(inventory, `- #1 search (see #2 for the dialog)\n- #2 modal\n- #3 player\n`).code, 0);
const twoTables = lint(inventory, `- #1 a\n- #3 c\n`);
eq('duplicate ids across inventory tables are one row (one problem line, not two)', [twoTables.code, twoTables.problems], [1, 1]);
eq('inventory without rows → exit 1', lint('# empty\n', '- #1 a\n').code, 1);
const usage = spawnSync(process.execPath, [script, '--lint', join(dir, 'nope.md'), join(dir, 'plan.md')], { encoding: 'utf8' });
eq('missing file → exit 2', usage.status, 2);

rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`${failed} assertion(s) failed`); process.exit(1); }
console.log('dynamics-plan lint: all assertions pass');
