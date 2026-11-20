#!/usr/bin/env node
// skills/reskin/scripts/test/capture-content.test.mjs — capture-content.mjs: --help answers before any I/O, and the
// slots of a scope never include a <script>, <style>, <noscript> or <template> child (a JSON-LD <script> in `main` is
// metadata, not a section), though JSON-LD still reaches metadata.jsonLd. The page cases run the CLI on a local file in
// plain Chromium (needs playwright; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'capture-content.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'capture-content-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const LD_PAGE = '{"@context":"https://schema.org","@type":"WebPage","name":"Home page"}';
const LD_ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Org"}';
const page = (body) => `<!doctype html><html lang="en"><head><title>Home</title><script type="application/ld+json">${LD_ORG}</script></head><body>${body}</body></html>`;
const SECTIONS = '<section><h2>First section</h2><p>Alpha copy</p></section><section><h2>Second section</h2><p>Beta copy</p></section>';

const capture = (name, html, extra = []) => {
  const file = join(scratch, `${name}.html`);
  const out = join(scratch, `${name}-out`);
  writeFileSync(file, html);
  const r = spawnSync(process.execPath, [SCRIPT, '--url', pathToFileURL(file).href, '--out', out, ...extra], { encoding: 'utf8', cwd: scratch });
  const modelFile = join(out, 'content-model.json');
  return { ...r, model: existsSync(modelFile) ? JSON.parse(readFileSync(modelFile, 'utf8')) : null };
};

await check('--help answers with usage and exit 0, and writes nothing', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: scratch });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: node capture-content\.mjs --url <page-url> --out <dir>/);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  capture-content against a page (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  await check('a JSON-LD script in main is no slot: the sections are the two that hold text, and the JSON-LD is in metadata.jsonLd', () => {
    const r = capture('ld-in-main', page(`<main><script type="application/ld+json">${LD_PAGE}</script>${SECTIONS}</main>`));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.model.sections.map((s) => s.headings.map((h) => h.text)), [['First section'], ['Second section']]);
    assert.ok(!JSON.stringify(r.model.sections).includes('@context'), 'no slot holds the JSON');
    assert.deepEqual(r.model.metadata.jsonLd.map((j) => j['@type']).sort(), ['Organization', 'WebPage'], 'both scripts are metadata');
    assert.ok(!r.model.visibleTextNormalized.includes('@context'));
  });

  await check('a script beside a single wrapper does not stop the descent into it: the wrapper\'s sections are the slots', () => {
    const r = capture('ld-beside-wrapper', page(`<main><div class="wrap">${SECTIONS}</div><script type="application/ld+json">${LD_PAGE}</script></main>`));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.model.sections.map((s) => s.headings.map((h) => h.text)), [['First section'], ['Second section']]);
    assert.equal(r.model.metadata.jsonLd.length, 2);
  });

  await check('style, noscript and template children of the scope are no slots either', () => {
    const r = capture('other-hidden', page(`<main><style>.x { color: red; }</style><template><p>Template copy</p></template><noscript>Enable scripts</noscript>${SECTIONS}</main>`));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.model.sections.length, 2);
    assert.deepEqual(r.model.sections.map((s) => s.headings[0].text), ['First section', 'Second section']);
  });
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
