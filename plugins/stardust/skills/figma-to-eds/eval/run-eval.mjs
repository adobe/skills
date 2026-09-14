#!/usr/bin/env node
// Self-contained eval for the figma-to-eds gate scripts. Runs on a
// SYNTHETIC design system (fixture/) — no Figma connection, no client
// data. Proves: token probe (positive + negative), geometry gate, and
// component-diff round-trip (self-reference = 0.00%).
// Usage: NODE_MODULES_DIR=<node_modules with playwright/pixelmatch/pngjs> node run-eval.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = resolve(here, '..', 'scripts');
const work = mkdtempSync(join(tmpdir(), 'figma-to-eds-eval-'));
cpSync(join(here, 'fixture'), work, { recursive: true });
const page = 'file://' + join(work, 'page.html');
let pass = 0; let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };
const run = (script, args) => spawnSync('node', [join(scripts, script), ...args], { encoding: 'utf8' });

// 1. token probe — positive
let r = run('token-probe.mjs', ['--tokens', join(work, 'donor-tokens.json'), '--css', join(work, 'styles.css'), '--out', join(work, 'probe.json')]);
check('token-probe positive (all synthetic tokens byte-match)', r.status === 0);

// 2. token probe — negative (perturb one value; probe must FAIL)
const sheet = JSON.parse(readFileSync(join(work, 'donor-tokens.json'), 'utf8'));
sheet.tokens.colors['--color-action-core'].value = '#3355ab';
writeFileSync(join(work, 'donor-tokens-bad.json'), JSON.stringify(sheet));
r = run('token-probe.mjs', ['--tokens', join(work, 'donor-tokens-bad.json'), '--css', join(work, 'styles.css'), '--out', join(work, 'probe-bad.json')]);
check('token-probe negative (single-hex perturbation detected)', r.status === 1);

// 3. geometry gate
const spec = readFileSync(join(work, 'geometry-spec.json'), 'utf8').replace('FIXTURE_PAGE_URL', page);
writeFileSync(join(work, 'geometry-spec.json'), spec);
r = run('geometry-gate.mjs', ['--spec', join(work, 'geometry-spec.json'), '--out', join(work, 'geometry-report.json')]);
check('geometry gate (boxes + gapFrom on the fixture page)', r.status === 0);

// 4. component-diff round trip: seed a reference screenshot of the page,
// then diff the page against it — must be ~0.00%
const boot = spawnSync('node', ['--input-type=module', '-e', `
  import { createRequire } from 'node:module';
  const req = createRequire(process.env.NODE_MODULES_DIR + '/x.cjs');
  const { chromium } = req('playwright');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.goto(${JSON.stringify(page)});
  await p.evaluate(() => document.fonts.ready);
  await p.locator('main').screenshot({ path: ${JSON.stringify(join(work, 'seed.png'))} });
  await b.close();
`], { encoding: 'utf8', env: process.env });
if (boot.status !== 0) console.error(boot.stderr);
r = run('component-diff.mjs', ['--figma', join(work, 'seed.png'), '--page', page, '--width', '1200', '--selector', 'main', '--out', join(work, 'diff-out'), '--threshold', '0.05']);
check('component-diff round-trip (self-reference ~0.00%)', r.status === 0);

console.log(`\neval: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
