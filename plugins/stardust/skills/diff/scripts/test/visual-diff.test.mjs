#!/usr/bin/env node
// skills/diff/scripts/test/visual-diff.test.mjs — visual-diff.mjs's two-sided flags: sourceTwin (the source image a
// build image stands for — rendered box + natural ratio, never the file name), headingFaceDiffers (size > 1 px, family
// case-insensitive), redFlags (a stretch the source shares is no flag, a source crop the build distorts is one);
// --help with no browser; then end to end against two fixture pages where playwright is importable (a skip line
// otherwise). Also normFamily (packaging suffixes are one face), pairHeadings (duplicates in document order), the
// ×N HEADING FACE summary, and IMAGE FIT (info, the source distorts what the build crops). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headingFaceDiffers, normFamily, pairHeadings, redFlags, sourceTwin } from '../visual-diff.mjs';
import { resolveProfile } from '../diff-profiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'visual-diff.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const prof = resolveProfile('generic');
const img = (src, natural, rendered, fit = 'fill', stretched = false) => ({ src, natural, rendered, fit, stretched, failedToLoad: false });
const page = (images = [], headings = []) => ({ blankRender: false, mainHeight: 1000, textLen: 500, images, headings, eyebrows: [], flushText: [], contentBoxes: [] });
const heading = (text, fontSize, family) => ({ tag: 'h2', text, color: 'rgb(0, 0, 0)', fontSize, family, fontLoaded: true });

// ---- pure ------------------------------------------------------------------------------------------
await check('sourceTwin: pairs by rendered box (±2 px) and natural ratio (±4 %), never by file name; first unused wins', () => {
  const src = [img('thumb-a.jpg', '1200x774', '140x140', 'cover'), img('thumb-b.jpg', '1200x774', '140x140', 'cover')];
  const used = new Set();
  assert.equal(sourceTwin(img('media_1.jpg', '1200x774', '141x139'), src, used).src, 'thumb-a.jpg');
  assert.equal(sourceTwin(img('media_2.jpg', '1200x774', '140x140'), src, used).src, 'thumb-b.jpg');
  assert.equal(sourceTwin(img('media_3.jpg', '1200x774', '140x140'), src, used), null, 'both used');
  assert.equal(sourceTwin(img('media_4.jpg', '600x600', '140x140'), src, new Set()), null, 'another natural ratio');
  assert.equal(sourceTwin(img('media_5.jpg', '1200x774', '200x140'), src, new Set()), null, 'another box');
});
await check('headingFaceDiffers: a family that differs only in case is one face; > 1 px or another family is a difference', () => {
  assert.equal(headingFaceDiffers(heading('a', '40px', 'Manrope'), heading('a', '40px', 'manrope')), false);
  assert.equal(headingFaceDiffers(heading('a', '40px', 'Manrope'), heading('a', '40.8px', 'Manrope')), false);
  assert.equal(headingFaceDiffers(heading('a', '40px', 'Manrope'), heading('a', '36px', 'Manrope')), true);
  assert.equal(headingFaceDiffers(heading('a', '40px', 'Manrope'), heading('a', '40px', 'Inter')), true);
});
await check('redFlags: a stretch the source shares is no flag; a source cover crop the build distorts is STRETCHED naming the source fit; no twin → STRETCHED', () => {
  const src = page([img('hero.webp', '1440x523', '1440x588', 'fill', true), img('thumb.jpg', '1200x774', '140x140', 'cover')]);
  const build = page([img('media_a.webp', '1440x523', '1440x588', 'fill', true), img('media_b.jpg', '1200x774', '140x140', 'fill', true), img('media_c.jpg', '800x400', '300x300', 'fill', true)]);
  const flags = redFlags(build, src, prof).filter((f) => f.startsWith('STRETCHED'));
  assert.equal(flags.length, 2, flags.join('\n'));
  assert.match(flags[0], /^STRETCHED IMAGE: media_b\.jpg natural 1200x774 → rendered 140x140 \(source: object-fit cover at the same box\)\. /);
  assert.match(flags[1], /^STRETCHED IMAGE: media_c\.jpg natural 800x400 → rendered 300x300\. /);
});
await check('redFlags: a matched heading at another size is HEADING FACE; the same face in another case is not', () => {
  const flags = redFlags(page([], [heading('Pricing', '48px', 'manrope'), heading('Plans', '40px', 'Manrope')]), page([], [heading('Pricing', '48px', 'Manrope'), heading('Plans', '32px', 'Manrope')]), prof);
  assert.deepEqual(flags, [`HEADING FACE: <h2> "Plans" is 40px Manrope in build vs 32px Manrope in source. ${prof.hints.HEADING_FACE}`]);
});
await check('normFamily: first family of the stack, unquoted, lowercased, without variable / VF / weight suffixes', () => {
  assert.equal(normFamily('"Manrope Variable", sans-serif'), 'manrope');
  assert.equal(normFamily('manrope'), 'manrope');
  assert.equal(normFamily("'InterVF'"), 'inter');
  assert.equal(normFamily('Inter Var'), 'inter');
  assert.equal(normFamily('Lato-Bold'), 'lato');
  assert.equal(normFamily('Montserrat Extra Bold'), 'montserrat');
  assert.equal(normFamily('Helvetica Neue'), 'helvetica neue');
  assert.equal(normFamily('Times New Roman'), 'times new roman');
  assert.equal(normFamily('Bold'), 'bold', 'never empties a name');
  assert.equal(headingFaceDiffers(heading('a', '40px', 'Manrope Variable'), heading('a', '40px', 'manrope')), false);
});
await check('pairHeadings: duplicate texts pair in document order, never all with the last', () => {
  const src = [heading('Learn more', '20px', 'A'), heading('Learn more', '30px', 'A'), heading('Only source', '20px', 'A')];
  const pairs = pairHeadings(src, [heading('learn more', '20px', 'A'), heading('Learn more', '30px', 'A'), heading('Learn more', '40px', 'A')]);
  assert.deepEqual(pairs.map(([p, h]) => [p.fontSize, h.fontSize]), [['20px', '20px'], ['30px', '30px']]);
  const flags = redFlags(page([], [heading('Learn more', '20px', 'A'), heading('Learn more', '30px', 'A')]), page([], src), prof);
  assert.deepEqual(flags, [], flags.join('\n'));
});
await check('redFlags: one family pair on every differing heading is ONE ×N HEADING FACE line, plus any size difference', () => {
  const texts = ['One', 'Two', 'Three'];
  const src = page([], texts.map((t) => heading(t, '40px', 'Helvetica Neue')));
  const build = page([], texts.map((t, k) => heading(t, k === 2 ? '30px' : '40px', 'inter')));
  const flags = redFlags(build, src, prof);
  assert.equal(flags.length, 2, flags.join('\n'));
  assert.equal(flags[0], `HEADING FACE ×3: "Helvetica Neue" → "inter" on every differing heading (source → build). ${prof.hints.HEADING_FACE}`);
  assert.match(flags[1], /^HEADING FACE: <h2> "Three" is 30px inter in build vs 40px Helvetica Neue in source\./);
  const mixed = redFlags(page([], [heading('One', '40px', 'Inter'), heading('Two', '40px', 'Inter')]), page([], [heading('One', '40px', 'Arial'), heading('Two', '40px', 'Georgia')]), prof);
  assert.equal(mixed.length, 2, 'two family pairs stay per heading');
  assert.ok(mixed.every((f) => f.startsWith('HEADING FACE: <h2>')), mixed.join('\n'));
});
await check('redFlags: a fill twin under the stretch threshold is never named as the crop to copy; the source distorting what the build crops is IMAGE FIT (info)', () => {
  const near = redFlags(page([img('b.jpg', '1000x1000', '105x100', 'fill', true)]), page([img('s.jpg', '1040x1000', '105x100', 'fill', false)]), prof);
  assert.equal(near.length, 1, near.join('\n'));
  assert.match(near[0], /\(source: undistorted fill at the same box, its ratio under the 4 % threshold\)/);
  assert.doesNotMatch(near[0], /object-fit fill/);
  const info = redFlags(page([img('b.jpg', '1200x774', '140x140', 'cover')]), page([img('s.jpg', '1200x774', '140x140', 'fill', true)]), prof);
  assert.deepEqual(info, [`IMAGE FIT (info): b.jpg natural 1200x774 → rendered 140x140 is object-fit cover in build; source stretches it (fill) at the same box. ${prof.hints.IMAGE_FIT}`]);
});
await check('--help: exit 0 with the usage, no browser needed', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^usage: node skills\/diff\/scripts\/visual-diff\.mjs/);
});

// ---- end to end (needs playwright) -----------------------------------------------------------------
let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  end-to-end visual-diff (playwright not importable here; run this test in an environment that has it)'); }
if (playwrightOk) {
  // a 4×2 grey PNG: natural ratio 2, drawn into square boxes
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAADklEQVR4nGNoQAIMyBwAnBoMATyCc0QAAAAASUVORK5CYII=';
  const doc = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}main{padding:40px}img{display:block;margin:8px 0}</style></head><body><main><h2>Plans</h2><p>${'Ordinary copy. '.repeat(10)}</p>${body}</main></body></html>`;
  const pages = {
    '/source.html': doc(`<img src="${PNG}" style="width:120px;height:120px;object-fit:cover"><img src="${PNG}" style="width:200px;height:200px">`),
    '/build.html': doc(`<img src="${PNG}" style="width:120px;height:120px"><img src="${PNG}" style="width:200px;height:200px">`),
  };
  const server = createServer((req, res) => {
    const body = pages[req.url.split('?')[0]];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const out = mkdtempSync(join(tmpdir(), 'vdiff-'));
  const r = await new Promise((resolveRun) => {
    const child = spawn(process.execPath, [SCRIPT, `${base}/source.html`, `${base}/build.html`, '--profile', 'generic', '--width', '800', '--out', out]);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
  await check('e2e: the build distorting an image the source crops is ONE STRETCHED flag naming the source fit; the stretch both sides share is none', () => {
    assert.equal(r.status, 0, r.stderr);
    const stretched = r.stdout.split('\n').filter((l) => l.includes('STRETCHED IMAGE'));
    assert.equal(stretched.length, 1, r.stdout.split('Full metrics JSON')[0]);
    assert.match(stretched[0], /natural 4x2 → rendered 120x120 \(source: object-fit cover at the same box\)/);
  });
  server.close();
  rmSync(out, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failing` : '\nvisual-diff: all checks passed');
process.exit(failed ? 1 : 0);
