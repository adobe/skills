#!/usr/bin/env node
// skills/reskin/scripts/test/capture-content.test.mjs — capture-content.mjs: --help answers before any I/O, and the
// slots of a scope never include a <script>, <style>, <noscript> or <template> child (a JSON-LD <script> in `main` is
// metadata, not a section), though JSON-LD still reaches metadata.jsonLd. The page cases run the CLI on a local file in
// plain Chromium (needs playwright; prints a skip line otherwise), with the text-less links a slot keeps as iconLinks.
// Run: node <this file>.
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

  await check('a text-less link is an iconLink named by aria-label, title, img alt, svg title or its host; ctas keep the texted ones', () => {
    const svg = (t) => `<svg width="24" height="24" viewBox="0 0 24 24">${t ? `<title>${t}</title>` : ''}<rect width="24" height="24"/></svg>`;
    const icons = [
      `<a href="https://www.facebook.com/sample" aria-label="Facebook">${svg()}</a>`,
      `<a href="https://x.example/sample" title="X">${svg()}</a>`,
      '<a href="/crest"><img alt="Crest" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>',
      `<a href="https://www.instagram.com/sample">${svg('Instagram')}</a>`,
      `<a href="https://www.youtube.com/sample">${svg()}</a>`,
      `<a href="https://hidden.example/" style="display:none">${svg()}</a>`,
    ].join('');
    const r = capture('icon-links', page(`<footer><section><h2>Follow us</h2><p><a href="/contact">Contact</a></p>${icons}</section></footer>`), ['--scope', 'footer!']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [s] = r.model.sections;
    assert.deepEqual(s.ctas.map((a) => a.text), ['Contact']);
    assert.deepEqual(s.iconLinks.map((a) => [a.label, a.href]), [
      ['Facebook', 'https://www.facebook.com/sample'], ['X', 'https://x.example/sample'], ['Crest', '/crest'],
      ['Instagram', 'https://www.instagram.com/sample'], ['youtube.com', 'https://www.youtube.com/sample'],
    ]);
    assert.match(s.iconLinks[2].absHref, /^file:.*\/crest$/);
  });

  await check('0.41 structure: tables as rows, disclosures with rest state (read before the ledger opens them), glyphs, sr-only, image width', () => {
    const ledger = join(scratch, 'open-all.mjs');
    writeFileSync(ledger, `export const NORMALIZE = \`(() => { document.querySelectorAll('[aria-expanded]').forEach((b) => { b.setAttribute('aria-expanded', 'true'); const p = document.getElementById(b.getAttribute('aria-controls')); if (p) p.removeAttribute('hidden'); }); })()\`;\nexport const LEDGER = [{ id: 'N1', what: 'open every accordion', why: 'test' }];\n`);
    const acc = (id, open, title, body) => `<h3><button aria-expanded="${open}" aria-controls="${id}">${title} <span aria-hidden="true" style="font-family: 'Material Icons'">keyboard_arrow_down</span></button></h3><div id="${id}"${open ? '' : ' hidden'}><p>${body}</p></div>`;
    const body = `<main><section>
      <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Skip note</span>
      <h2>Facts</h2>
      <table><tr><th>Year</th><th>Count</th></tr><tr><td>2024</td><td><a href="/c">12</a></td></tr></table>
      ${acc('p1', false, 'Closed one', 'Closed body')}${acc('p2', true, 'Open one', 'Open body')}
      <p><img alt="Hero" width="640" height="320" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></p>
    </section></main>`;
    const r = capture('structure', page(body), ['--normalize', ledger, '--scope', 'main section!']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [s] = r.model.sections;
    assert.equal(s.orderedVerified, true, 'the stream still tiles visibleText');
    const flat = (ns) => ns.flatMap((n) => [n, ...flat(n.children || [])]);
    const all = flat(s.ordered);
    const table = s.ordered.find((n) => n.kind === 'table');
    assert.deepEqual(table.rows.map((row) => row.map((c) => c.text)), [['Year', 'Count'], ['2024', '12']]);
    assert.equal(table.rows[0][0].header, true);
    assert.equal(table.rows[1][1].children[0].kind, 'cta');
    assert.ok(all.some((n) => n.text === 'Skip note' && n.srOnly), 'sr-only text is marked');
    const glyphs = all.filter((n) => n.text === 'keyboard_arrow_down');
    assert.equal(glyphs.length, 2); assert.ok(glyphs.every((g) => g.glyph && g.toggle), 'ligature is a glyph inside its toggle');
    assert.ok(all.some((n) => n.text === 'Closed one' && n.toggle === 'p1' && !n.toggleOpen), 'closed at rest');
    assert.ok(all.some((n) => n.text === 'Open one' && n.toggle === 'p2' && n.toggleOpen), 'open at rest');
    assert.deepEqual(s.ordered.find((n) => n.text === 'Closed body').panels, ['p1']);
    assert.equal(all.find((n) => n.kind === 'image').rw, 640);
  });
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
