#!/usr/bin/env node
// Test: encode/shape.mjs — C14, the rule that lets an encoded sibling skip the local harness launches (section-schema,
// block-roundtrip --ew, qa-gate) the archetype passed:
//
//   shape         shapeOf: blocks (metadata and section-metadata excepted) with sorted variants, row counts and cell
//                 kinds (empty, image, text, image+text); whitespace never changes it; the encoder records it as
//                 audit.encode.shape on a clean page, equal to the shape of the document it wrote
//   coverage      covers: a block, its variants, a row count within the range seen, every row's cells seen
//   skip rule     inherited: only a passedOn under the current key that covers the shape; a key change or a new shape
//                 re-arms; planHarness: needsHarness per page in delivery order (representatives, key moved)
//   harness key   the encoder, the map (compact JSON), every file of a block the map emits, the frozen foundation
//                 (recomputed from disk): a block or foundation edit moves it, a re-freeze of the same files does not
//   passedOn      migrate.mjs harness: recorded under the key, an equal record never rewritten, a pass under a moved key
//                 replaces the record; refused for a stopped page and for an archetype whose gated document has
//                 another shape than its encode
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-shape.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../encode.mjs';
import { covers, harnessKey, inherited, passedOnWith, planHarness, shapeOf } from '../encode/shape.mjs';

const HERE = import.meta.dirname;
const MIGRATE = join(HERE, '..', 'migrate.mjs');
const FREEZE = join(HERE, '..', '..', '..', 'replica', 'scripts', 'foundation-freeze.mjs');
const A = 'trips-river-walk'; const S1 = 'trips-forest-loop';
const T = mkdtempSync(join(tmpdir(), 'encode-shape-'));
cpSync(join(HERE, 'fixtures', 'encode'), T, { recursive: true });
const P = (rel) => join(T, rel);
const read = (rel) => readFileSync(P(rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const write = (rel, data) => { mkdirSync(dirname(P(rel)), { recursive: true }); writeFileSync(P(rel), data); };
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const encode = async () => { const out = []; const code = await main(['--root', T, '--template', A], { out: (s) => out.push(s), err: (s) => out.push(s) }); assert.equal(code, 0, out.join('\n')); };
const cli = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: T, encoding: 'utf8' });
const stamp = (rel) => { const s = statSync(P(rel)); return `${s.ino}:${s.mtimeMs}`; };
const key = async () => (await harnessKey(T, A)).key;

const DOC = { [A]: 'stardust/encoded/trips/river-walk.html', [S1]: 'stardust/encoded/trips/forest-loop.html' };
const SIDE = { [A]: 'stardust/migrated/trips/river-walk._meta.json', [S1]: 'stardust/migrated/trips/forest-loop._meta.json' };
const VOCAB = `stardust/import/${A}/vocabulary.json`; const GATED = 'content/trips/river-walk.html';
write('stardust/state.json', pretty({
  site: { originUrl: 'https://www.example.com' }, flow: 'replica', flowChosenAt: '2026-10-01T00:00:00Z', flowSource: 'test',
  pages: [{ slug: A, url: 'https://www.example.com/trips/river-walk.html', title: 'River Walk', status: 'migrated', type: 'trip' }, { slug: S1, url: 'https://www.example.com/trips/forest-loop.html', title: 'Forest Loop', status: 'directed', type: 'trip' }],
}));

const doc = (sections) => `<body><header></header><main>${sections.map((s) => `<div>${s}</div>`).join('')}</main><footer></footer></body>`;
const block = (cls, rows) => `<div class="${cls}">${rows.map((r) => `<div>${r.map((c) => `<div>${c}</div>`).join('')}</div>`).join('')}</div>`;
const b = (name, rows, ...cells) => ({ block: name, rows, cells: cells.length ? cells : Array(rows).fill('text') });

try {
  // --- shape --------------------------------------------------------------------------------------------------------
  const page = doc([
    `${block('metadata', [['Title', 'A page']])}<h1>A page</h1>`,
    `${block('cards wide dark', [['<picture><img src="/a.jpg" alt=""></picture>', '<p>One</p>'], ['', '<p>Two <img src="/b.jpg" alt=""></p>'], ['&nbsp; ', '<img src="/c.jpg" alt="">']])}<p>Text</p>${block('section-metadata', [['style', 'dark']])}`,
  ]);
  const want = [{ block: 'cards dark wide', rows: 3, cells: ['image,text', 'empty,image+text', 'empty,image'] }];
  assert.deepEqual(shapeOf(page), want, 'blocks with sorted variants, rows and cell kinds; metadata, section-metadata and default content are no blocks');
  assert.deepEqual(shapeOf(page.replace(/></g, '>\n  <').replace('dark wide', 'wide  dark')), want, 'whitespace and variant order never change a shape');
  assert.deepEqual(shapeOf('<body><p>no main</p></body>'), []);

  await encode();
  for (const s of [A, S1]) {
    const side = json(SIDE[s]);
    assert.equal(side.audit.encode.status, 'clean');
    assert.deepEqual(side.audit.encode.shape, shapeOf(read(DOC[s])), `${s}: audit.encode.shape is the shape of the document the encoder wrote`);
  }
  const shapeA = json(SIDE[A]).audit.encode.shape; const shapeS = json(SIDE[S1]).audit.encode.shape;
  assert.deepEqual(shapeA, shapeOf(read(GATED)), 'the archetype\'s encode and its gated document have one shape');
  assert.deepEqual(shapeS.find((x) => x.block === 'tabs'), { block: 'tabs', rows: 3, cells: ['text,text', 'text,text', 'text,text'] });

  // --- coverage -------------------------------------------------------------------------------------------------------
  const ex = [[b('cards', 1, 'image,text'), b('hero', 1, 'image,text')], [b('cards', 4, 'image,text', 'image,text', 'text', 'image,text')]];
  assert.deepEqual(covers([b('cards', 3, 'text', 'image,text', 'text'), b('hero', 1, 'image,text')], ex), { covered: true, gaps: [] }, 'a row count inside the range seen, row cells seen on any page');
  assert.deepEqual(covers([b('cards', 5, 'text', 'text', 'text', 'text', 'text')], ex).gaps, ['"cards" has 5 rows (exercised 1–4)']);
  assert.deepEqual(covers([b('cards wide', 1, 'image,text')], ex).gaps, ['block "cards wide" is new'], 'a new variant is a new block');
  assert.deepEqual(covers([b('cards', 2, 'image,text', 'empty,text')], ex).gaps, ['"cards" has a row of cells [empty,text] (new)'], 'an empty optional cell is a new row shape');
  assert.deepEqual(covers([b('tabs', 2)], ex).gaps, ['block "tabs" is new']);

  // --- skip rule: inherited and planHarness ----------------------------------------------------------------------------
  const K = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  const K2 = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
  const arch = [b('cards', 2, 'image,text', 'image,text'), b('hero', 1, 'image,text')];
  const passed = passedOnWith(null, { key: K, slug: 'a', shape: arch });
  assert.deepEqual(passed, { key: K, shapes: [{ slug: 'a', shape: arch }] });
  const same = [b('hero', 1, 'image,text'), b('cards', 2, 'image,text', 'image,text')]; const fresh = [b('cards', 3, 'image,text', 'image,text', 'image,text')];
  assert.equal(inherited({ key: K, passedOn: passed, shape: same }).ok, true, 'skip: passedOn under the current key covers the shape');
  assert.match(inherited({ key: K, passedOn: passed, shape: same }).why, /^covered by passedOn under sha256:111111111111… \(a\)$/);
  assert.deepEqual(inherited({ key: K2, passedOn: passed, shape: same }), { ok: false, why: 'the harness key moved since the recorded pass (sha256:111111111111… → sha256:222222222222…)' }, 'a key change re-arms');
  assert.deepEqual(inherited({ key: K, passedOn: passed, shape: fresh }), { ok: false, why: 'shape not covered: "cards" has 3 rows (exercised 2)' }, 'a new shape re-arms');
  assert.equal(inherited({ key: K, passedOn: null, shape: same }).ok, false, 'no passedOn: nothing to inherit');
  const both = passedOnWith(passed, { key: K, slug: '0-first', shape: fresh });
  assert.deepEqual(both.shapes.map((e) => e.slug), ['0-first', 'a'], 'a pass under the same key joins, sorted by slug');
  assert.equal(inherited({ key: K, passedOn: both, shape: fresh }).ok, true, '… and covers its shape from then on');
  assert.deepEqual(passedOnWith(both, { key: K2, slug: 'a', shape: arch }), { key: K2, shapes: [{ slug: 'a', shape: arch }] }, 'a pass under another key replaces the record');

  const ok = (shape) => ({ ok: true, why: 'the current clean encode', shape });
  const pages = [
    { slug: 'a', isArchetype: true, encoded: ok(arch), convert: ['cards', 'hero'] },
    { slug: 's1', encoded: ok(same) },
    { slug: 's2', encoded: ok(fresh) },
    { slug: 's3', encoded: ok(fresh) },
    { slug: 's4', encoded: { ok: false, why: 'encode stopped: variance' } },
    { slug: 's5', encoded: null },
    { slug: 's6', encoded: ok([...same, b('quote', 1)]), convert: ['quote'] },
    { slug: 's7', encoded: ok(same), convert: ['cards'] },
  ];
  const plan = (o) => Object.fromEntries([...planHarness({ pages, ...o })].map(([s, v]) => [s, `${v.needsHarness ? 'RUN' : 'skip'}: ${v.why}`]));
  assert.deepEqual(plan({ key: K, passedOn: passed }), {
    a: 'skip: covered by passedOn under sha256:111111111111… (a)',
    s1: 'skip: covered by passedOn under sha256:111111111111… (a)',
    s2: 'RUN: new shape: "cards" has 3 rows (exercised 2)',
    s3: 'skip: covered once s2 pass the launches',
    s4: 'RUN: encode stopped: variance',
    s5: 'RUN: not an encoded page: it runs the launches',
    s6: 'RUN: block code is written for it (converts quote)',
    s7: 'skip: covered by passedOn under sha256:111111111111… (a)',
  }, 'a new shape runs once, on its first page; a later page with it is covered once that page passes; a page whose block code passed under the key needs no re-run');
  assert.deepEqual(plan({ key: K2, passedOn: passed }), {
    a: 'RUN: the harness key moved since the recorded pass (sha256:111111111111… → sha256:222222222222…)',
    s1: 'skip: covered once a pass the launches',
    s2: 'RUN: new shape: "cards" has 3 rows (exercised 2) (the harness key moved since the recorded pass (sha256:111111111111… → sha256:222222222222…))',
    s3: 'skip: covered once a, s2 pass the launches',
    s4: 'RUN: encode stopped: variance',
    s5: 'RUN: not an encoded page: it runs the launches',
    s6: 'RUN: block code is written for it (converts quote)',
    s7: 'RUN: block code is written for it (converts cards)',
  }, 'a key change re-arms the archetype and the representatives; the rest wait for them');
  assert.deepEqual([plan({ key: K, passedOn: null }).a, plan({ key: K, passedOn: null }).s1], ['RUN: the archetype records no harness pass (passedOn)', 'skip: covered once a pass the launches']);
  assert.equal(planHarness({ key: K, passedOn: null, pages: pages.slice(1, 2) }).get('s1').why, 'the archetype records no harness pass (passedOn)', 'no pass and no representative: the plain reason');
  assert.deepEqual(Object.values(plan({ key: null, keyError: 'no map', passedOn: passed })).every((v) => v.startsWith('RUN: no harness key (no map)')), true, 'no key: every page runs');

  // --- harness key --------------------------------------------------------------------------------------------------
  write('blocks/hero/hero.js', 'export default function decorate(block) { block.dataset.ok = "1"; }\n');
  write('blocks/hero/hero.css', '.hero { display: grid; }\n');
  write('blocks/quote/quote.js', 'export default function decorate() {}\n');
  write('styles/styles.css', 'body { margin: 0; }\n');
  const k0 = await key();
  assert.match(k0, /^sha256:[0-9a-f]{64}$/); assert.equal(await key(), k0, 'the key is stable');
  assert.deepEqual((await harnessKey(T, A)).blocks, ['facts', 'hero', 'links', 'tabs', 'tags', 'teaser'], 'the blocks the map emits');
  write('blocks/quote/quote.js', 'export default function decorate(block) { block.remove(); }\n');
  assert.equal(await key(), k0, 'a block the map never emits is not in the key');
  const vocabRaw = read(VOCAB);
  write(VOCAB, JSON.stringify(JSON.parse(vocabRaw), null, 4));
  assert.equal(await key(), k0, 'a whitespace-only map edit keeps the key (compact JSON, as encode.map)');
  write(VOCAB, vocabRaw);
  write('blocks/hero/hero.css', '.hero { display: flex; }\n');
  const k1 = await key();
  assert.notEqual(k1, k0, 'a block CSS edit moves the key');
  write('blocks/tabs/tabs.js', 'export default function decorate() {}\n');
  const k2 = await key();
  assert.notEqual(k2, k1, 'block code written for a block the map emits moves the key');
  let f = cli(FREEZE, ['freeze', '--paths', 'styles/']);
  assert.equal(f.status, 0, f.stderr);
  const k3 = await key();
  assert.notEqual(k3, k2, 'freezing the foundation moves the key');
  f = cli(FREEZE, ['freeze', '--paths', 'styles/']); assert.equal(f.status, 0, f.stderr);
  assert.equal(await key(), k3, 'a re-freeze of the same files (a new frozenAt) keeps it');
  write('styles/styles.css', 'body { margin: 1px; }\n');
  assert.notEqual(await key(), k3, 'a foundation edit moves the key before any re-freeze');
  write('styles/styles.css', 'body { margin: 0; }\n');
  assert.equal(await key(), k3, '… and reverting it restores the key');

  // --- passedOn: migrate.mjs harness ----------------------------------------------------------------------------------
  let r = cli(MIGRATE, ['harness', A]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `harness ${A}: recorded — ${A} passedOn under ${k3.slice(0, 19)}…: ${A}\n`);
  assert.deepEqual(json(SIDE[A]).passedOn, { key: k3, shapes: [{ slug: A, shape: shapeA }] }, 'the archetype\'s pass under the current key');
  const s0 = stamp(SIDE[A]);
  r = cli(MIGRATE, ['harness', A]);
  assert.equal(r.status, 0); assert.match(r.stdout, /: unchanged — /); assert.equal(stamp(SIDE[A]), s0, 'an equal record is never rewritten');
  await encode();
  assert.deepEqual(json(SIDE[A]).passedOn.key, k3, 'an encode run keeps passedOn');
  assert.equal(inherited({ key: await key(), passedOn: json(SIDE[A]).passedOn, shape: shapeS }).ok, false, 'the fixture sibling\'s shape is new to the template (tabs 3 rows, tags 2 cells)');
  r = cli(MIGRATE, ['harness', S1]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(SIDE[A]).passedOn.shapes.map((e) => e.slug), [S1, A], 'the sibling that ran the launches joins');
  assert.equal(inherited({ key: k3, passedOn: json(SIDE[A]).passedOn, shape: shapeS }).ok, true);
  write('blocks/hero/hero.js', 'export default function decorate(block) { block.dataset.ok = "2"; }\n');
  const k4 = await key();
  assert.equal(inherited({ key: k4, passedOn: json(SIDE[A]).passedOn, shape: shapeA }).ok, false, 'a block edit re-arms even the archetype');
  r = cli(MIGRATE, ['harness', S1]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /\(the key moved: the earlier record is replaced\)\n$/);
  assert.deepEqual(json(SIDE[A]).passedOn, { key: k4, shapes: [{ slug: S1, shape: shapeS }] }, 'a pass under the moved key replaces the record');

  // refusals: nothing written
  const s1 = stamp(SIDE[A]); const gated = read(GATED);
  write(GATED, gated.replace('<div class="teaser featured">', '<div class="teaser">'));
  r = cli(MIGRATE, ['harness', A]);
  assert.equal(r.status, 2); assert.equal(r.stdout, '');
  assert.equal(r.stderr, `harness ${A}: refused — ${GATED} and the archetype's encode differ in shape (encode vs gated: block "teaser featured" is new) — the map does not round-trip: encode.mjs --roundtrip --template ${A}\n`);
  assert.equal(stamp(SIDE[A]), s1);
  write(GATED, gated);
  const side = json(SIDE[S1]); write(SIDE[S1], pretty({ ...side, audit: { ...side.audit, encode: { ...side.audit.encode, status: 'variance' } } }));
  r = cli(MIGRATE, ['harness', S1]);
  assert.equal(r.status, 2); assert.match(r.stderr, new RegExp(`^harness ${S1}: refused — encode stopped: .*audit\\.encode\\.status is variance`));
  assert.equal(stamp(SIDE[A]), s1, 'a stopped page never joins passedOn');

  console.log('encode-shape: ok');
} finally {
  rmSync(T, { recursive: true, force: true });
}
