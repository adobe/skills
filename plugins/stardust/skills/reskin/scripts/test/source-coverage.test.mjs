#!/usr/bin/env node
// skills/reskin/scripts/test/source-coverage.test.mjs — gate (a′): what the content reference did not take in.
// Pure cases cover judge() and readDeclared(). The page cases capture a local source page that has a sidebar outside
// `main`, a dark band and a feed that keeps appending a post every 700 ms until 7 s after load (past capture's fixed waits), then gate three targets against it: one that carries all
// three (PASS), one that drops them (FAIL on S1 and S3), and the same drop declared with a why (PASS). They need
// playwright and print a skip line otherwise.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { judge, readDeclared, parseArgs, probeOf } from '../source-coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'source-coverage.mjs');
const CAPTURE = join(HERE, '..', 'capture-content.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'source-coverage-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const NONE = { residue: [], tones: [], blocking: true };
const MODEL = {
  residue: [
    { sel: 'aside.sidebar', kind: 'aside', textLen: 80, lines: ['Section navigation', 'Wellbeing', 'Careers'] },
    { sel: 'div.crumbs', kind: 'breadcrumb', textLen: 12, lines: ['Home', 'Here'] },
    { sel: 'header', kind: 'chrome', textLen: 300, lines: ['Menu'] },
  ],
  sections: [
    { slot: 's01', tone: 'dark', headings: [{ text: 'Dark band' }] },
    { slot: 's02', tone: 'tinted', headings: [{ text: 'Grey band' }] },
    { slot: 's03', tone: 'page', headings: [{ text: 'Plain' }] },
  ],
  _provenance: { settle: { stable: true, waitedMs: 1500, lateChars: 0 } },
};

await check('parseArgs reads every flag and rejects an unknown one', () => {
  const o = parseArgs(['--model', 'm.json', '--target', 't', '--declared', 'd.json', '--min-chars', '5', '--out', 'o.json']);
  assert.deepEqual([o.model, o.target, o.declared, o.minChars, o.out], ['m.json', 't', 'd.json', 5, 'o.json']);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['--token-env', 'T']), /unknown argument/, 'no site auth: a protected preview is out of scope');
});

await check('readDeclared requires version 1, a why on every entry, a slot id and a known tone', () => {
  assert.deepEqual(readDeclared({ version: 1, residue: [{ match: 'aside', why: 'x' }] }).problems, []);
  const { problems } = readDeclared({ version: 2, residue: [{ match: 'aside' }], tones: [{ slot: 'one', to: 'black' }], extra: 1 });
  assert.ok(problems.some((p) => /unknown key "extra"/.test(p)));
  assert.ok(problems.some((p) => /version must be 1/.test(p)));
  assert.ok(problems.some((p) => /residue\[0\]: why/.test(p)));
  assert.ok(problems.some((p) => /tones\[0\]: slot/.test(p)));
  assert.ok(problems.some((p) => /tones\[0\]: to must be/.test(p)));
  assert.equal(readDeclared({ version: 1, blocking: false }).declared.blocking, false);
});

await check('S1: an aside not found in the target FAILs; a short breadcrumb is info only; chrome is not gated', () => {
  const r = judge(MODEL, { regions: [0.2, 0], slotTones: { s01: 'dark', s02: 'tinted' } }, NONE, 20);
  const s1 = r.rows.filter((x) => x.check === 'S1');
  assert.deepEqual(s1.map((x) => [x.kind, x.verdict]), [['aside', 'FAIL'], ['breadcrumb', 'info']]);
  assert.equal(r.verdict, 'FAIL 1/3');
});

await check('S1: recall ≥ 0.6 carries the region; a declared match by selector passes it with the why', () => {
  assert.equal(judge(MODEL, { regions: [0.67, 0], slotTones: { s01: 'dark', s02: 'tinted' } }, NONE, 20).verdict, 'PASS');
  const d = readDeclared({ version: 1, residue: [{ match: 'aside.sidebar', why: 'menu lives in the header' }] }).declared;
  const r = judge(MODEL, { regions: [0, 0], slotTones: { s01: 'dark', s02: 'tinted' } }, d, 20);
  assert.equal(r.rows[0].verdict, 'declared');
  assert.equal(r.rows[0].why, 'menu lives in the header');
  assert.equal(r.verdict, 'PASS');
});

await check('S3: dark → light FAILs, tinted → page WARNs, page slots are not checked, a declared tone passes', () => {
  const r = judge(MODEL, { regions: [1, 1], slotTones: { s01: 'tinted', s02: 'page' } }, NONE, 20);
  const s3 = r.rows.filter((x) => x.check === 'S3');
  assert.deepEqual(s3.map((x) => [x.slot, x.verdict]), [['s01', 'FAIL'], ['s02', 'WARN']]);
  const d = readDeclared({ version: 1, tones: [{ slot: 's01', to: 'tinted', why: 'donor hero is light' }] }).declared;
  assert.equal(judge(MODEL, { regions: [1, 1], slotTones: { s01: 'tinted', s02: 'page' } }, d, 20).verdict, 'PASS');
  assert.equal(judge(MODEL, { regions: [1, 1], slotTones: { s01: null, s02: 'tinted' } }, NONE, 20).rows.find((x) => x.slot === 's01').verdict, 'FAIL', 'a dark band whose heading is gone fails');
});

await check('S2: a model without a settle record, or captured unstable, WARNs and never fails', () => {
  const noSettle = { ...MODEL, _provenance: {} };
  const r = judge(noSettle, { regions: [1, 1], slotTones: { s01: 'dark', s02: 'tinted' } }, NONE, 20);
  assert.equal(r.rows.find((x) => x.check === 'S2').verdict, 'WARN');
  assert.equal(r.verdict, 'PASS');
  const unstable = { ...MODEL, _provenance: { settle: { stable: false, waitedMs: 15000 } } };
  assert.match(judge(unstable, { regions: [1, 1], slotTones: { s01: 'dark', s02: 'tinted' } }, NONE, 20).rows.find((x) => x.check === 'S2').detail, /CAPTURE_SETTLE_CAP_MS/);
});

await check('S2: a Figma-sourced model (no settle step) is n/a, not a stale-capture warning', () => {
  const figma = { ...MODEL, _provenance: { source: { kind: 'figma' } } };
  const s2 = judge(figma, { regions: {}, slotTones: {} }, { residue: [], tones: [], blocking: true }, 80).rows.find((r) => r.check === 'S2');
  assert.equal(s2.verdict, 'n/a');
  assert.match(s2.detail, /^n\/a: Figma-sourced model/);
});
await check('blocking false turns a FAIL into ADVISORY', () => {
  const d = readDeclared({ version: 1, blocking: false }).declared;
  assert.match(judge(MODEL, { regions: [0, 0], slotTones: {} }, d, 20).verdict, /^ADVISORY 2\//);
});

await check('probeOf uses the first heading, else the slot text', () => {
  assert.equal(probeOf({ headings: [{ text: 'Hi' }] }), 'Hi');
  assert.equal(probeOf({ headings: [], visibleText: 'Body copy' }), 'Body copy');
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  source-coverage against pages (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const doc = (body) => `<!doctype html><html lang="en"><head><title>T</title><style>body{margin:0;background:#fff;font:16px sans-serif} .dark{background:rgb(99,0,25);color:#fff;padding:40px} .layout{display:flex}</style></head><body>${body}</body></html>`;
  const ASIDE = '<aside class="sidebar"><p>Section navigation</p><ul><li><a href="#a">Learning and support</a></li><li><a href="#b">Wellbeing programs</a></li><li><a href="#c">Careers advice</a></li></ul></aside>';
  const SOURCE = doc(`<header><a href="/">School</a></header><div class="layout">${ASIDE}<main><section><h2>Plain section</h2><p>Opening copy for the page.</p></section><section class="dark"><h2>Dark callout band</h2><p>Book a tour today.</p></section><section id="feed"><h2>Latest posts</h2></section></main></div><script>let n=0;const t=setInterval(()=>{n+=1;const p=document.createElement('p');p.textContent=n===10?'Late feed post about the athletics carnival results.':'Feed post number '+n+' arrived.';document.getElementById('feed').append(p);if(n===10)clearInterval(t);},700)</script>`);
  const CARRIED = doc(`<header><a href="/">School</a></header><main><div class="layout">${ASIDE}<div><div class="section"><h2>Plain section</h2><p>Opening copy for the page.</p></div><div class="section dark"><h2>Dark callout band</h2><p>Book a tour today.</p></div><div><h2>Latest posts</h2><p>Late feed post about the athletics carnival results.</p></div></div></div></main>`);
  const DROPPED = doc('<header><a href="/">School</a></header><main><div class="section"><h2>Plain section</h2><p>Opening copy for the page.</p></div><div class="section" style="background:#f2f2f2"><h2>Dark callout band</h2><p>Book a tour today.</p></div><div><h2>Latest posts</h2></div></main>');
  const write = (n, html) => { const f = join(scratch, n); writeFileSync(f, html); return f; };
  const src = write('source.html', SOURCE);
  const out = join(scratch, 'cap');
  const cap = spawnSync(process.execPath, [CAPTURE, '--url', pathToFileURL(src).href, '--out', out, '--scope', 'main'], { encoding: 'utf8', cwd: scratch });
  const modelFile = join(out, 'content-model.json');
  const model = existsSync(modelFile) ? JSON.parse(readFileSync(modelFile, 'utf8')) : null;
  const gate = (target, extra = []) => spawnSync(process.execPath, [GATE, '--model', modelFile, '--target', write(`${target.name}.html`, target.html), ...extra], { encoding: 'utf8', cwd: scratch });

  await check('capture-content records the late paragraph (settle), the dark band (tone) and the aside (residue)', () => {
    assert.equal(cap.status, 0, cap.stdout + cap.stderr);
    assert.ok(model.visibleTextNormalized.includes('athletics carnival'), 'the last post, appended at +7s, is in the model');
    assert.equal(model._provenance.settle.stable, true);
    assert.ok(model._provenance.settle.lateChars > 0, 'chars appended during the settle are counted');
    const dark = model.sections.find((s) => (s.headings || []).some((h) => h.text === 'Dark callout band'));
    assert.equal(dark.tone, 'dark');
    assert.equal(model.sections.find((s) => (s.headings || []).some((h) => h.text === 'Plain section')).tone, 'page');
    const aside = (model.residue || []).find((r) => r.kind === 'aside');
    assert.ok(aside, `aside residue recorded: ${JSON.stringify(model.residue)}`);
    assert.ok(aside.lines.includes('Wellbeing programs'));
    assert.ok(!(model.residue || []).some((r) => r.kind === 'aside' && r.lines.includes('Plain section')), 'the scope is not residue');
  });

  await check('a target that carries the aside and the dark band PASSes', () => {
    const r = gate({ name: 'carried', html: CARRIED });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /S1 carried\s+aside/);
    assert.match(r.stdout, /S3 carried\s+s\d+ dark → dark/);
    assert.match(r.stdout, /\] PASS/);
  });

  await check('a target that drops the aside and lightens the dark band FAILs on S1 and S3', () => {
    const r = gate({ name: 'dropped', html: DROPPED }, ['--out', join(scratch, 'report.json')]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /S1 FAIL\s+aside/);
    assert.match(r.stdout, /S3 FAIL\s+s\d+ dark → tinted/);
    const rep = JSON.parse(readFileSync(join(scratch, 'report.json'), 'utf8'));
    assert.match(rep.verdict, /^FAIL 2\//);
  });

  await check('the same drops declared with a why PASS; an invalid declared file exits 2', () => {
    const slot = model.sections.find((s) => s.tone === 'dark').slot;
    const decl = write('declared.json', JSON.stringify({ version: 1, residue: [{ match: 'aside', why: 'section menu moved to the header' }], tones: [{ slot, to: 'tinted', why: 'donor band is light' }] }));
    const r = gate({ name: 'dropped2', html: DROPPED }, ['--declared', decl]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /S1 declared/);
    assert.match(r.stdout, /S3 declared/);
    const bad = write('bad.json', JSON.stringify({ version: 1, residue: [{ match: 'aside' }] }));
    assert.equal(gate({ name: 'dropped3', html: DROPPED }, ['--declared', bad]).status, 2);
  });
}

rmSync(scratch, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
