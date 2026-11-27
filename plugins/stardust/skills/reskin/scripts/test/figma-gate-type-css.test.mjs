#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-type-css.test.mjs — type-css: typeCss and injectTypeCss (pure, over the
// synthetic kit), then the CLI on fixtures/figma-gate/page.html with its type broken: ramp fails, type-css, ramp
// passes (needs playwright; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNormalizations } from '../figma/rules.mjs';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { breakpoint, injectTypeCss, suffixSelector, typeCss } from '../figma-gate/type-css.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const FIX = join(HERE, 'fixtures');
const read = (...p) => JSON.parse(readFileSync(join(FIX, ...p), 'utf8'));
const nodes = read('figma-kit', 'nodes.json');
const rules = read('figma-kit', 'curation-rules.json');
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const norm = parseNormalizations(rules.normalizations, []);
const rootEntries = rootTokens(read('figma-gate', 'donor-tokens.json')).entries;
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-type-css-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const joined = { sections: [{ slot: 's02', module: 'M2', node: '1:7', selector: 'main section[data-slot="s02"]', index: 0 }] };
const checksAt = (type, roots = { 1440: '1:7' }) => ({ s02: { root: '1:7', width: 1440, roots, geometry: [], type, pixel: { mode: 'auto' } } });

await check('typeCss: the Figma style on the scoped selector, raised once; color apart, at rest, as var(<token>)', () => {
  const { css, rules: n, entries, families, conflicts } = typeCss({ join: joined, checks: checksAt([{ id: 't1', selector: 'h2', node: 'I1:7;5:2', width: 1440 }]), boxes, norm, rootEntries });
  assert.ok(css.includes('main section[data-slot="s02"] h2:not(#figma-type) { font-size: 40px; font-weight: 700; line-height: 48px; letter-spacing: -0.8px; font-family: Inter, sans-serif; }'), css);
  assert.ok(css.includes('main section[data-slot="s02"] h2:not(#figma-type):not(:hover):not(:focus-visible):not(:active) { color: var(--color-accent); }'), css);
  assert.deepEqual([n, entries, families, conflicts], [2, 1, ['Inter'], []]);
});

await check('typeCss: a narrower width goes in @media (max-width) and is raised once more; the widest has no @media', () => {
  const type = [{ id: 't1', selector: 'h2', node: 'I1:7;5:2', width: 1440 }, { id: 't2', selector: 'h2', node: 'I1:7;5:8', width: 390 }];
  const { css } = typeCss({ join: joined, checks: checksAt(type, { 1440: '1:7', 390: '1:7' }), boxes, norm, rootEntries });
  const media = css.indexOf('@media (max-width: 899px) {');
  assert.ok(media > css.indexOf('h2:not(#figma-type) {'), css);
  assert.ok(css.slice(media).includes('h2:not(#figma-type):not(#figma-type) { font-size: 14px;'), css);
  assert.equal(css.split('@media').length, 2);
});

await check('typeCss: one selector at one width with two styles is a conflict; the same style twice is one rule', () => {
  const twice = [{ id: 't1', selector: 'h2', node: 'I1:7;5:2', width: 1440 }, { id: 't2', selector: 'h2', node: 'I1:7;5:2', width: 1440 }];
  assert.deepEqual(typeCss({ join: joined, checks: checksAt(twice), boxes, norm, rootEntries }).entries, 1);
  const clash = [{ id: 't1', selector: 'h2', node: 'I1:7;5:2', width: 1440 }, { id: 't2', selector: 'h2', node: 'I1:7;5:8', width: 1440 }];
  assert.deepEqual(typeCss({ join: joined, checks: checksAt(clash), boxes, norm, rootEntries }).conflicts, [{ width: 1440, selector: 'main section[data-slot="s02"] h2', a: 's02 t1', b: 's02 t2' }]);
});

await check('suffixSelector: every branch, before a trailing pseudo-element; breakpoint: 899 across 900, else the midpoint', () => {
  assert.equal(suffixSelector('a .b, p::before, :is(h1, h2)', 'X'), 'a .bX, pX::before, :is(h1, h2)X');
  assert.deepEqual([breakpoint(390, 1440), breakpoint(390, 768), breakpoint(1024, 1440)], [899, 578, 1231]);
});

await check('injectTypeCss: the last <style> before </head>, replacing the previous one', () => {
  const once = injectTypeCss('<html><head><style>a{}</style>\n</head><body></body></html>', 'b{}\n');
  assert.equal(once, '<html><head><style>a{}</style>\n<style data-figma-type>\nb{}\n</style>\n</head><body></body></html>');
  assert.equal(injectTypeCss(once, 'c{}'), once.replace('b{}', 'c{}'));
  assert.throws(() => injectTypeCss('<p>no head</p>', 'b{}'), /no <\/head>/);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  type-css then ramp on page.html (playwright not importable here)'); }

if (playwrightOk) {
  await check('a page whose module type is off fails ramp, names type-css; after type-css the ramp passes and the CSS file is written', () => {
    const p = makeProject(join(scratch, 'broken'));
    const font = join(HERE, '..', '..', '..', '..', '..', 'aem', 'project-management', 'fonts', 'SourceSans3-Regular.otf');
    copyFileSync(font, join(p.root, 'face.otf'));
    const html = readFileSync(p.page, 'utf8')
      .replace('<style>', '<style>\n@font-face { font-family: Inter; src: url("face.otf"); font-weight: 100 900; }')
      .replace('h2 { font: 700 40px/48px', 'h2 { font: 400 32px/40px')
      .replace('.card-label { font: 500 14px/20px', '.card-label { font: 500 16px/24px');
    writeFileSync(p.page, html);
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--page', p.slug, '--url', p.page, '--dir', p.dir], { cwd: p.root, encoding: 'utf8' });
    const before = run('ramp');
    assert.equal(before.status, 1, before.stdout + before.stderr);
    assert.match(before.stdout, /hint: the page has no <style data-figma-type>: run figma-gate\.mjs type-css/);
    const made = run('type-css');
    assert.equal(made.status, 0, made.stdout + made.stderr);
    assert.match(made.stdout, /type-css \d+ rule\(s\) for 8 type entries/);
    assert.match(made.stdout, /fonts to serve: Inter/);
    assert.ok(existsSync(join(p.dir, 'reskin', 'figma-type', 'home.css')));
    const after = run('ramp');
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.match(after.stdout, /ramp PASS/);
    assert.equal(run('type-css').status, 0);
    assert.equal(readFileSync(p.page, 'utf8').split('<style data-figma-type>').length, 2, 'a second run replaces, never stacks');
  });
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
