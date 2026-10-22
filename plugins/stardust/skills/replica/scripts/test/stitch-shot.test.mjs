#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — the font check of stitch-shot.mjs, no browser for the pure part:
// importing the module starts no capture; --help answers in an empty cwd with nothing written (playwright and pngjs
// load lazily) and names --json; --json without a file is a usage error (exit 1, nothing written); faceKey (family +
// weight + style, normal = 400, bold = 700, quotes and case folded); deadFontFaces — a face with status 'error' and no
// loaded face of the same key is dead (a 404 bold beside a loaded regular is; a failed declaration beside a loaded twin
// is not; an unresolved local() source — status 'error', no URL anywhere — is; an 'unloaded' face never is; every face
// loaded → []); fontCheckOutcome — a face list → { fontsFailed }, an error or no list → { fontsFailed: null, fontCheck:
// "failed: <first line>" }, never []; fontCheckLines — the one stderr line per outcome. End to end, where playwright and
// pngjs are importable (a project copy — the plugin tree ships no node_modules; skipped with one line otherwise): a
// page whose faces 404 and name a local() font this machine lacks → fontsFailed names both beside the one WARNING; a
// page with no @font-face → []; document.fonts that throws → fontsFailed null + fontCheck and one stderr line, exit 0; a
// failed capture writes no record and removes an earlier one.
// Run: node plugins/stardust/skills/replica/scripts/test/stitch-shot.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deadFontFaces, faceKey, fontCheckLines, fontCheckOutcome, fontFamilies, parseArgs } from '../stitch-shot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'stitch-shot.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const face = (family, status, weight = 'normal', style = 'normal') => ({ family, weight, style, status });

await check('importing the module starts no capture; --help exits 0 in an empty cwd, writes nothing and names --json and fontsFailed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-help-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--json <file> +after the PNG, write the capture record/);
    assert.match(r.stdout, /fontsFailed \(\[\] = every declared face loaded, or the dead faces' families/);
    assert.match(r.stdout, /local\(\) source this browser cannot resolve/);
    assert.match(r.stdout, /null = the check could not run, then fontCheck/);
    assert.deepEqual(readdirSync(cwd), [], 'nothing written');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('--json: parsed as the record file; a missing value (end of argv or a flag next) is a usage error, exit 1, nothing written', () => {
  assert.equal(parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png', '--json', 'rec.json']).opts.json, 'rec.json');
  assert.equal(parseArgs(['node', 'stitch-shot.mjs', 'https://x.test/', 'o.png']).opts.json, null, 'off by default');
  const cwd = mkdtempSync(join(tmpdir(), 'stitch-json-'));
  try {
    for (const tail of [['--json'], ['--json', '--settle']]) {
      const r = spawnSync(process.execPath, [SCRIPT, 'http://127.0.0.1:9/', 'x.png', ...tail], { cwd, encoding: 'utf8', timeout: 15000 });
      assert.equal(r.status, 1, `${tail.join(' ')}: ${r.stderr}`);
      assert.match(r.stderr, /^--json needs a file/);
      assert.deepEqual(readdirSync(cwd), [], 'nothing written');
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
await check('fontFamilies: surrounding quotes stripped, trimmed, empties dropped, unique, sorted — the record\'s fontsFailed', () => {
  assert.deepEqual(fontFamilies([' "Z" ', 'Brand Sans', '"Brand Sans"', "'Brand Sans'", '', null, undefined]), ['Brand Sans', 'Z']);
  assert.deepEqual(fontFamilies([]), []); assert.deepEqual(fontFamilies(undefined), []);
});
await check('faceKey: family (unquoted, case-folded) + weight + style — normal = 400, bold = 700, an absent descriptor is the default; a bare string is a family at the defaults', () => {
  assert.equal(faceKey({ family: '"Brand Sans"', weight: 'normal', style: 'normal' }), 'brand sans|400|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: 'bold' }), 'brand sans|700|normal');
  assert.equal(faceKey({ family: 'brand SANS', weight: '700', style: 'Normal' }), 'brand sans|700|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: '100  900', style: 'italic' }), 'brand sans|100 900|italic', 'a variable range is kept as written');
  assert.equal(faceKey('Brand Sans'), 'brand sans|400|normal');
  assert.equal(faceKey({ family: 'Brand Sans', weight: '400' }), faceKey({ family: "'Brand Sans'", weight: 'normal' }), 'normal and 400 are one weight');
  assert.notEqual(faceKey({ family: 'Brand Sans', weight: '400' }), faceKey({ family: 'Brand Sans', weight: '700' }));
});
await check('deadFontFaces: keyed by family, weight and style — a 404 bold beside a loaded regular is dead; a failed declaration beside a loaded twin of the same key is not', () => {
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'error', '700')]), ['Brand Sans'], 'another weight loaded: the bold renders in fallback type — dead');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded', 'bold'), face('Brand Sans', 'error', '700')]), [], 'the same weight loaded (bold = 700): a duplicate declaration, not dead');
  assert.deepEqual(deadFontFaces([face('"Brand Sans"', 'loaded'), face('Brand Sans', 'error', 'normal')]), [], 'quotes do not split a key');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'error', 'normal', 'italic')]), ['Brand Sans'], 'another style loaded: the italic is dead');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'error'), face('Brand Sans', 'error', '700'), face('Other', 'error')]), ['Brand Sans', 'Other'], 'a family is named once, sorted');
});
await check('deadFontFaces: an unresolved local() source is dead like a failed fetch — status error, no URL anywhere; an unloaded face (never needed) is not; every face loaded → []; no faces → []', () => {
  // the recorded shape: metric fallback faces declared with local() platform fonts the gate's browser does not have
  const fallback = [face('Brand Sans', 'error'), face('Brand Sans Fallback', 'error'), face('Brand Serif Fallback', 'error', '400', 'normal')];
  assert.deepEqual(deadFontFaces(fallback), ['Brand Sans', 'Brand Sans Fallback', 'Brand Serif Fallback']);
  assert.deepEqual(deadFontFaces([face('Unused', 'unloaded'), face('Brand Sans', 'loaded')]), [], 'unloaded: never needed by any text');
  assert.deepEqual(deadFontFaces([face('Brand Sans', 'loaded'), face('Brand Sans', 'loaded', '700'), face('Brand Serif', 'loaded')]), []);
  assert.deepEqual(deadFontFaces([]), []); assert.deepEqual(deadFontFaces(null), []); assert.deepEqual(deadFontFaces([null, 'x']), []);
});
await check('fontCheckOutcome: a face list → { fontsFailed } (checked, no fontCheck key); an error or no list → { fontsFailed: null, fontCheck: "failed: <first line>" } — never []', () => {
  const ok = fontCheckOutcome([face('Brand Sans', 'error'), face('Other', 'loaded')], null);
  assert.deepEqual(ok, { fontsFailed: ['Brand Sans'] });
  assert.ok(!('fontCheck' in ok), 'fontCheck only when the check failed');
  assert.deepEqual(fontCheckOutcome([face('Other', 'loaded')], null), { fontsFailed: [] });
  const bad = fontCheckOutcome(null, new Error('page.evaluate: Execution context was destroyed\n    at main'));
  assert.deepEqual(bad, { fontsFailed: null, fontCheck: 'failed: page.evaluate: Execution context was destroyed' });
  assert.deepEqual(Object.keys(bad), ['fontsFailed', 'fontCheck'], 'fontCheck right after fontsFailed');
  assert.deepEqual(fontCheckOutcome(undefined, 'timeout'), { fontsFailed: null, fontCheck: 'failed: timeout' });
  assert.deepEqual(fontCheckOutcome({ not: 'a list' }, null), { fontsFailed: null, fontCheck: 'failed: no face list returned' });
});
await check('fontCheckLines: a check that could not run → ONE stderr line saying the record is fontsFailed: null (not checked); dead faces → one WARNING naming them and both causes; every face loaded → none', () => {
  const skipped = fontCheckLines({ fontsFailed: null, fontCheck: 'failed: fonts unavailable' });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0], 'stitch-shot WARNING: font-load check failed (fonts unavailable) — the record says fontsFailed: null (not checked): no face is known to have loaded');
  assert.deepEqual(fontCheckLines({ fontsFailed: [] }), []);
  const dead = fontCheckLines({ fontsFailed: ['Brand Sans', 'Brand Sans Fallback'] });
  assert.equal(dead.length, 1);
  assert.match(dead[0], /^stitch-shot WARNING: FONT LOAD FAILED for declared face\(s\) Brand Sans, Brand Sans Fallback — this capture renders fallback type for them/);
  assert.match(dead[0], /the file failed to fetch, or a local\(\) source names a font this browser does not have/);
  assert.match(fontCheckLines({})[0], /font-load check failed \(unknown\)/, 'no outcome at all reads as not checked');
});

// ---- end to end: playwright + pngjs importable from here (a project copy) ----------------------------------------------
let chromium = null;
try { ({ chromium } = await import('playwright')); await import('pngjs'); } catch { console.log('skip  e2e (playwright / pngjs not importable here — project devDependencies; the pure checks above ran)'); }
if (chromium) {
  const page = (body, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body style="margin:0">${body}</body></html>`;
  const pages = {
    // the recorded shape: a face whose file 404s and a metric fallback face declared with a local() font this machine lacks;
    // a face no text uses stays unloaded
    '/fonts': page('<section style="height:1200px;font-family:\'Brand Sans\',\'Brand Fallback\',sans-serif">Brand type</section>', '<style>@font-face{font-family:"Brand Sans";src:url(/missing.woff2) format("woff2")}@font-face{font-family:"Brand Fallback";src:local("No Such Platform Font Zz");size-adjust:105%}@font-face{font-family:"Unused";src:local("No Such Unused Font Zz")}</style>'),
    '/clean': page('<section style="height:1200px">Plain type</section>'),
    // a page whose document.fonts throws: the font-load check cannot run
    '/fonts-unreadable': page('<section style="height:1200px">Text</section>', '<script>Object.defineProperty(document, \'fonts\', { configurable: true, get() { throw new Error(\'fonts unavailable\'); } });</script>'),
  };
  const server = createServer((req, res) => { const body = pages[req.url.split('?')[0]]; res.writeHead(body ? 200 : 404, { 'content-type': body ? 'text/html; charset=utf-8' : 'text/plain' }); res.end(body || 'nope'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const work = mkdtempSync(join(tmpdir(), 'stitch-e2e-'));
  // asynchronous: the pages are served from this process, so the event loop must keep running while the capture loads them
  const run = (args) => new Promise((resolve) => {
    const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd: work });
    let stdout = ''; let stderr = '';
    ch.stdout.on('data', (d) => { stdout += d; }); ch.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => ch.kill('SIGKILL'), 120000);
    ch.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
  const record = (f) => JSON.parse(readFileSync(join(work, f), 'utf8'));
  const warnings = (r) => r.stderr.split('\n').filter((l) => /WARNING/.test(l));
  try {
    await check('e2e: a face whose file 404s and a fallback face whose local() names a font this machine lacks are both dead — fontsFailed names them beside the one WARNING; the unused face is not; exit 0', async () => {
      const r = await run([`${base}/fonts`, 'fonts.png', '--json', 'fonts.json']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(warnings(r).length, 1, r.stderr);
      assert.match(warnings(r)[0], /FONT LOAD FAILED for declared face\(s\) Brand Fallback, Brand Sans — /);
      const j = record('fonts.json');
      assert.deepEqual(j.fontsFailed, ['Brand Fallback', 'Brand Sans']);
      assert.ok(!('fontCheck' in j), 'a check that ran carries no fontCheck');
      assert.deepEqual(Object.keys(j), ['url', 'out', 'width', 'vh', 'settle', 'fontsFailed', 'height']);
      assert.deepEqual([j.url, j.out, j.width, j.vh, j.settle], [`${base}/fonts`, 'fonts.png', 1440, 900, false]);
      assert.ok(existsSync(join(work, 'fonts.png')));
    });
    await check('e2e: a page with no @font-face → fontsFailed [] and no WARNING', async () => {
      const r = await run([`${base}/clean`, 'clean.png', '--json', 'clean.json']);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(warnings(r), []);
      assert.deepEqual(record('clean.json').fontsFailed, []);
    });
    await check('e2e: a font-load check that cannot run (document.fonts throws) → fontsFailed null + fontCheck right after it, ONE stderr WARNING, exit 0', async () => {
      const r = await run([`${base}/fonts-unreadable`, 'unread.png', '--json', 'unread.json']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(warnings(r).length, 1, r.stderr);
      assert.match(warnings(r)[0], /^stitch-shot WARNING: font-load check failed \(.*fonts unavailable.*\) — the record says fontsFailed: null \(not checked\)/);
      const j = record('unread.json');
      assert.equal(j.fontsFailed, null);
      assert.match(j.fontCheck, /^failed: .*fonts unavailable/);
      assert.doesNotMatch(j.fontCheck, /\n/);
      const keys = Object.keys(j);
      assert.equal(keys[keys.indexOf('fontsFailed') + 1], 'fontCheck', keys.join(','));
    });
    await check('e2e: a failed capture (nothing listens) writes no record and removes an earlier one at the same path', async () => {
      writeFileSync(join(work, 'failed.json'), '{ "stale": true }\n');
      const r = await run(['http://127.0.0.1:9/', 'failed.png', '--json', 'failed.json']);
      assert.notEqual(r.status, 0, 'the capture failed');
      assert.equal(existsSync(join(work, 'failed.json')), false, 'the earlier record is gone');
      assert.equal(existsSync(join(work, 'failed.png')), false);
    });
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
