#!/usr/bin/env node
/**
 * Fixture test: section-schema.mjs `structure` facts + `⚠ generic-with-structure`, and qa-gate.mjs's FAIL on a
 * default-content section with structure (T28.4, audit-and-naming.md § 2b) + `h1Section` (T21.2).
 * Run: node skills/deploy/scripts/test/section-schema-structure.test.mjs   (exit 1 on failure)
 *
 * Browser half (Playwright over file:// — zero network): a prototype with (i) a prose section, (ii) a two-column
 * "compare plans" section with no repeat units, (iii) a tabs widget inside a prose-looking section, (iv) three
 * `.card` siblings:
 *   - structure facts: (i) interactive=[] columns=1 · (ii) columns=2 · (iii) [role=tablist] + [aria-controls];
 *     `hasH1` on the first section only; (iv) one repeat unit `DIV.card` × 3 — the grouping rule injected from
 *     schema-checks.mjs repeatUnitGroups (T28.2), (ii) has none;
 *   - a second run over the same --out keeps the `defaultContent` triage recorded on the file and prints
 *     `⚠ generic-with-structure` for (ii) and (iii), not (i); the object form prints the recorded reason;
 *   - qa-gate.mjs --schema on a decorated page that renders (ii) as default content: `✗ generic-with-structure`,
 *     exit 1 (the BLOCKING branch); with the recorded `defaultContent.reason` it is ⚠ and exit 0; a section
 *     bound to a block passes; `h1Section` ok on the same page.
 * Playwright must resolve: from the scripts dir (an EDS project), else from STARDUST_PW_ROOT / STARDUST_GATE_DEPS
 * (symlinked as node_modules next to a copy of the scripts) — otherwise SKIP, exit 0 (the pure judgements are
 * pinned by schema-checks.test.mjs). A step that cannot continue prints a FAIL row and the FAILED summary
 * (exit 1) — never an uncaught stack (schema-checks.test.mjs runs this file against a stub playwright).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(here, '..');
const SKILLS = resolve(SCRIPTS, '..', '..');
let deps = null;
try { createRequire(join(SCRIPTS, 'x.mjs')).resolve('playwright'); deps = 'scripts'; } catch { /* not resolvable from the plugin tree */ }
for (const env of ['STARDUST_GATE_DEPS', 'STARDUST_PW_ROOT']) {
  if (deps || !process.env[env]) continue;
  const cand = [process.env[env], join(process.env[env], 'node_modules')].find((d) => existsSync(join(d, 'playwright', 'package.json')));
  if (cand) deps = cand;
}
if (!deps) { console.log('SKIP section-schema-structure: playwright not resolvable — set STARDUST_PW_ROOT=<dir with node_modules> (pure judgements: schema-checks.test.mjs)'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'section-schema-structure-'));
let scripts = SCRIPTS;
if (deps !== 'scripts') {
  cpSync(join(SKILLS, 'deploy', 'scripts'), join(dir, 'skills', 'deploy', 'scripts'), { recursive: true, filter: (src) => !/[\\/]test([\\/]|$)/.test(src) });
  cpSync(join(SKILLS, 'replica', 'scripts'), join(dir, 'skills', 'replica', 'scripts'), { recursive: true, filter: (src) => !/[\\/]test([\\/]|$)/.test(src) });
  for (const sk of ['dynamics', 'stardust']) cpSync(join(SKILLS, sk, 'scripts'), join(dir, 'skills', sk, 'scripts'), { recursive: true, filter: (src) => !/[\\/]test([\\/]|$)/.test(src) }); // qa-gate's control pass (dynamics lib.mjs driveControl) + the resolution chain / browser lock, copied as a set
  symlinkSync(resolve(deps), join(dir, 'node_modules'));
  scripts = join(dir, 'skills', 'deploy', 'scripts');
}
const run = (script, args, cwd = dir) => spawnSync(process.execPath, [join(scripts, script), ...args], { encoding: 'utf8', cwd, timeout: 80000 });

const proto = `<!doctype html><html><head><style>
  body{margin:0;font:16px/1.4 sans-serif} section{padding:24px}
  .compare .plans{display:grid;grid-template-columns:1fr 1fr;gap:24px} .compare .plan{border:1px solid #ccc;padding:12px}
  .faq [role=tablist]{display:flex;gap:8px} .faq button{padding:8px}
</style></head><body><main>
<section class="intro"><h1>Coverage that fits</h1><p>Members first, every day. A paragraph of prose about how the programme works and who it serves.</p></section>
<section class="compare"><h2>Compare plans</h2><div class="plans"><div class="plan"><h3>Basic</h3><p>Covers the essentials for one driver.</p></div><aside class="plan-notes"><h3>Plus</h3><p>Adds roadside help and a rental car.</p></aside></div></section>
<section class="faq"><h2>Questions</h2><div role="tablist"><button role="tab" aria-controls="q1" aria-selected="true">Claims</button><button role="tab" aria-controls="q2">Billing</button></div><div id="q1" role="tabpanel"><p>File a claim from the app or by phone, any hour.</p></div></section>
<section class="cards"><h2>Ways to save</h2><div class="grid" style="display:grid;grid-template-columns:repeat(3,1fr)"><div class="card"><h3>Bundle</h3><p>Two policies, one bill.</p><a href="#">More</a></div><div class="card"><h3>Pay in full</h3><p>Skip the instalment fee.</p><a href="#">More</a></div><div class="card"><h3>Go paperless</h3><p>Documents in the app.</p><a href="#">More</a></div></div></section>
</main></body></html>`;
writeFileSync(join(dir, 'proto.html'), proto);
const out = join(dir, 'schema.json');
let failed = 0;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`); if (!cond) failed = 1; };

try {
  // 1. facts
  let r = run('section-schema.mjs', [pathToFileURL(join(dir, 'proto.html')).href, '--out', out]);
  check(r.status === 0, `section-schema exits 0 (${r.stderr.trim().split('\n')[0] || 'ok'})`);
  if (!existsSync(out)) throw new Error(`section-schema wrote no ${out} (exit ${r.status}) — ${(r.stderr || r.stdout).split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'no output'}`);
  const schema = JSON.parse(readFileSync(out, 'utf8'));
  const by = Object.fromEntries(schema.sections.map((s) => [s.section, s]));
  check(JSON.stringify(by.intro.structure) === JSON.stringify({ interactive: [], columns: 1 }), `prose: ${JSON.stringify(by.intro.structure)}`);
  check(by.compare.structure.columns === 2 && by.compare.structure.interactive.length === 0, `two side-by-side plans (different tags, no repeat unit): ${JSON.stringify(by.compare.structure)}`);
  check(by.faq.structure.interactive.includes('[role=tablist]') && by.faq.structure.interactive.includes('[aria-controls]') && by.faq.structure.interactive.includes('button'), `tabs: ${JSON.stringify(by.faq.structure)}`);
  check(by.intro.hasH1 === true && by.compare.hasH1 === undefined && by.faq.hasH1 === undefined, 'hasH1 on the h1 section only');
  check(JSON.stringify(by.cards.repeats) === JSON.stringify([{ unitSelector: 'DIV.card', count: 3, unit: { headings: 1, ctas: 1, imgs: 0, textRuns: 3 }, uniform: true }]), `repeat units via schema-checks.mjs repeatUnitGroups (injected in-page): ${JSON.stringify(by.cards.repeats)}`);
  check(by.compare.repeats.length === 0 && by.cards.structure.columns === 3, 'different-tag siblings are no repeat unit; the cards measure 3 columns');
  check(!/generic-with-structure/.test(r.stdout), 'no triage yet → no ⚠ line');

  // 2. the triage recorded on the file survives a re-measure and drives the ⚠ print
  by.intro.defaultContent = true; by.compare.defaultContent = true; by.faq.defaultContent = { reason: 'tabs delivered by dynamics', dynamicsRow: 'dyn#4' }; by.compare.decodeTier = 'default';
  writeFileSync(out, JSON.stringify(schema, null, 1));
  r = run('section-schema.mjs', [pathToFileURL(join(dir, 'proto.html')).href, '--out', out]);
  check(r.status === 0, 're-run exits 0');
  const again = JSON.parse(readFileSync(out, 'utf8'));
  const by2 = Object.fromEntries(again.sections.map((s) => [s.section, s]));
  check(by2.intro.defaultContent === true && by2.compare.defaultContent === true && by2.compare.decodeTier === 'default' && by2.faq.defaultContent.dynamicsRow === 'dyn#4', 'defaultContent / decodeTier carried over by section name');
  check(/⚠ generic-with-structure compare: interactive=\[\] columns=2 — needs a block or a dynamics row/.test(r.stdout), `⚠ for the columns section: ${r.stdout.split('\n').filter((l) => l.includes('⚠')).join(' | ')}`);
  check(/⚠ generic-with-structure faq: interactive=\[.*\[role=tablist\].*\] columns=\d — recorded: dynamics row dyn#4, tabs delivered by dynamics/.test(r.stdout), 'the recorded escape prints its reason (two tab buttons side by side also measure as columns)');
  check(!/generic-with-structure intro/.test(r.stdout), 'prose is never flagged');

  // 3. qa-gate: the decorated page renders `compare` as default content → FAIL; recorded reason → ⚠; a block → pass
  const page = (compareAsBlock) => `<!doctype html><html><body class="appear"><main>
<div class="section"><div class="default-content-wrapper"><h1>Coverage that fits</h1><p>Members first.</p></div></div>
<div class="section">${compareAsBlock ? '<div class="compare-plans-wrapper"><div class="compare-plans block" data-block-name="compare-plans" data-block-status="loaded" style="display:grid;grid-template-columns:1fr 1fr;min-height:40px"><div><h3>Basic</h3></div><div><h3>Plus</h3></div></div></div>' : '<div class="default-content-wrapper"><h2>Compare plans</h2><h3>Basic</h3><p>Covers the essentials.</p><h3>Plus</h3><p>Adds roadside help.</p></div>'}</div>
<div class="section"><div class="default-content-wrapper"><h2>Questions</h2><p>Claims · Billing</p></div></div>
<div class="section"><div class="cards-wrapper"><div class="cards block" data-block-name="cards" data-block-status="loaded" style="display:grid;grid-template-columns:repeat(3,1fr);min-height:40px"><div><h3>Bundle</h3></div><div><h3>Pay in full</h3></div><div><h3>Go paperless</h3></div></div></div></div>
</main></body></html>`;
  writeFileSync(join(dir, 'page-prose.html'), page(false));
  writeFileSync(join(dir, 'page-block.html'), page(true));
  r = run('qa-gate.mjs', [pathToFileURL(join(dir, 'page-prose.html')).href, '--schema', out]);
  check(r.status === 1, `BLOCKING: a default-content section with structure FAILs qa-gate (exit ${r.status})`);
  check(/✗ generic-with-structure: section "compare" has interactive=\[\] columns=2 but renders as default content — needs a block or a dynamics row/.test(r.stdout), `the ✗ line: ${r.stdout.split('\n').filter((l) => /generic-with-structure/.test(l)).join(' | ')}`);
  check(/⚠ generic-with-structure: "faq" has .* renders as default content — recorded: dynamics row dyn#4, tabs delivered by dynamics/.test(r.stdout), 'the recorded escape is a ⚠, never a ✗');
  check(/✓ h1Section: h1 in its authored section \(#1\)/.test(r.stdout), 'h1Section ok when the h1 stayed put');
  r = run('qa-gate.mjs', ['--schema', out, pathToFileURL(join(dir, 'page-block.html')).href]);
  check(r.status === 0, `the same section as a block passes, URL after --schema (exit ${r.status}): ${r.stdout.split('\n').filter((l) => /✗/.test(l)).join(' | ')}`);
  // NEGATIVE (arguments): a value flag followed by a flag is usage, exit 2, no browser launched
  r = run('qa-gate.mjs', [pathToFileURL(join(dir, 'page-block.html')).href, '--marker', '--schema', out]);
  check(r.status === 2 && /qa-gate: --marker needs a value/.test(r.stderr) && !/identity:/.test(r.stdout), `--marker --schema is usage (exit ${r.status})`);
  r = run('qa-gate.mjs', [pathToFileURL(join(dir, 'page-block.html')).href, '--schema', out]);
  check(/✓ generic-with-structure: "compare" \(interactive=\[\] columns=2\) renders as block compare-plans/.test(r.stdout), 'bound to a block → ✓');
  // h1Section FAIL: the schema says the h1 lives in section 2 while the page renders it in section 1, and an auto-block is recorded
  const moved = JSON.parse(readFileSync(out, 'utf8')); delete moved.sections[0].hasH1; moved.sections[1].hasH1 = true; moved.sections[1].defaultContent = { reason: 'accepted' };
  writeFileSync(join(dir, 'schema-moved.json'), JSON.stringify(moved));
  r = run('qa-gate.mjs', [pathToFileURL(join(dir, 'page-block.html')).href, '--schema', join(dir, 'schema-moved.json')]); // no stardust/runtime-contract.json yet → the warn path
  check(r.status === 0 && /⚠ h1Section: h1 left its authored section: schema section #2 → page section #1 — no auto-block is recorded/.test(r.stdout), `moved h1 without autoBlocks → WARN (exit ${r.status})`);
  mkdirSync(join(dir, 'stardust'), { recursive: true });
  writeFileSync(join(dir, 'stardust', 'runtime-contract.json'), JSON.stringify({ autoBlocks: [{ fn: 'buildHeroBlock', trigger: 'main h1, main picture' }] }));
  r = run('qa-gate.mjs', [pathToFileURL(join(dir, 'page-block.html')).href, '--schema', join(dir, 'schema-moved.json')]);
  check(r.status === 1 && /✗ h1Section: h1 left its authored section: schema section #2 → page section #1 — an auto-block moved it \(runtime-contract\.json#autoBlocks: buildHeroBlock ← main h1, main picture\)/.test(r.stdout), `moved h1 with an auto-block → FAIL (exit ${r.status})`);
} catch (e) {
  // a step that cannot continue (no schema written, malformed JSON) is a FAIL row, never a stack trace
  console.log(`FAIL ${e.message}`);
  failed = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? 'section-schema-structure test: FAILED' : 'section-schema-structure test: ok (structure facts, hasH1, triage carry-over, ⚠ print, qa-gate ✗ / ⚠ / ✓, h1Section warn + fail)');
process.exit(failed);
