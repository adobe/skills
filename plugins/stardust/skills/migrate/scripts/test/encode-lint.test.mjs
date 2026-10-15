#!/usr/bin/env node
// Fixture test: encode/lint.mjs — `encode.mjs --lint` (the map checks C1–C6 plus the map, its inputs and the archetype)
// and `encode.mjs --sweep`, run in-process through encode.mjs's main() on scratch copies of the synthetic project
// fixtures/encode-lint (template "guide": archetype guides-alpha with its gated content/ document, siblings guides-beta
// and guides-gamma, stardust/eds-schema/guides-alpha.json, stardust/replica/units.json, the map under
// stardust/import/guides-alpha/). Each check has a passing case (the fixture as committed) and failing cases (one edit
// each, asserted to raise that check alone where the edit allows it). Also: reference/encode-map.schema.json and the
// engine's validators stay in step (every schema key is probed against validateVocabulary / validateTransform; every
// key the fixture maps use is in the schema). No browser, no network.
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-lint.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../encode.mjs';
import { COMMENT_KEY, KEYS, LINT_KEYS, validateTransform, validateVocabulary } from '../encode/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, 'fixtures', 'encode-lint');
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', '..', 'reference', 'encode-map.schema.json'), 'utf8'));
const A = 'guides-alpha';
const SCRATCH = mkdtempSync(join(tmpdir(), 'encode-lint-test-'));
process.on('exit', () => rmSync(SCRATCH, { recursive: true, force: true }));

let copies = 0;
const project = () => { const d = join(SCRATCH, `p${copies += 1}`); cpSync(FX, d, { recursive: true }); return d; };
const sha = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
const VOCAB = ['stardust', 'import', A, 'vocabulary.json'];
const CAPTURE = (slug) => ['stardust', 'current', 'pages', `${slug}.html`];
const readJ = (root, p) => JSON.parse(readFileSync(join(root, ...p), 'utf8'));
const writeJ = (root, p, v) => writeFileSync(join(root, ...p), `${JSON.stringify(v, null, 2)}\n`);
const editMap = (root, fn) => { const v = readJ(root, VOCAB); fn(v); writeJ(root, VOCAB, v); };
const editText = (root, p, from, to) => { const f = join(root, ...p); const s = readFileSync(f, 'utf8'); assert.ok(s.includes(from), `fixture ${p.join('/')} holds ${from}`); writeFileSync(f, s.replace(from, to)); };
// record the current shas of the inputs the map names, so an edit to an input raises its own check, not `inputs`
const syncInputs = (root) => editMap(root, (v) => { for (const k of ['capture', 'edsSchema', 'units']) { const r = v.inputs[k]; if (r && existsSync(join(root, r.path))) r.sha = sha(readFileSync(join(root, r.path))); } });
const marker = (v, sel) => { const m = v.markers.find((x) => x.sel === sel); assert.ok(m, `fixture map has marker ${sel}`); return m; };

async function run(root, ...args) {
  const out = []; const err = [];
  const code = await main(['--root', root, ...args], { out: (s) => out.push(...String(s).split('\n')), err: (s) => err.push(s) });
  return { code, out, err: err.join('\n'), last: out[out.length - 1] };
}
async function lint(root) {
  const r = await run(root, '--lint', '--template', A, '--json');
  r.report = JSON.parse(r.out[0]);
  r.checks = [...new Set(r.report.findings.map((f) => f.check))].sort();
  r.text = r.report.findings.map((f) => `${f.check} ${f.where} ${f.message}`).join('\n');
  return r;
}
async function only(root, check, re) {
  const r = await lint(root);
  assert.equal(r.code, 1, `${check}: a finding exits 1\n${r.text}\n${r.err}`);
  assert.deepEqual(r.checks, [check], `${check} alone\n${r.text}`);
  if (re) assert.match(r.text, re);
  return r;
}
// every file under a directory, with its bytes: --lint and --sweep write nothing
const snapshot = (dir) => readdirSync(dir, { recursive: true }).sort().map((f) => { const p = join(dir, f); try { return `${f} ${sha(readFileSync(p))}`; } catch { return `${f}/`; } }).join('\n');

// ===================================================================================== --lint: the fixture passes
{
  const root = project();
  const before = snapshot(root);
  const r = await lint(root);
  assert.equal(r.code, 0, `the fixture map lints clean\n${r.text}\n${r.err}`);
  assert.deepEqual(r.report.findings, []);
  assert.deepEqual(r.report.notes, [], 'every optional input is present and used: no note');
  assert.equal(r.last, `lint ${A}: 0 findings · 0 notes`, 'the verdict is the last line');
  assert.equal(r.report.inputs.capture.sha, readJ(root, VOCAB).inputs.capture.sha, 'the report carries the current input shas');
  const t = await run(root, '--lint', '--template', A);
  assert.equal(t.code, 0); assert.deepEqual(t.out, [`lint ${A}: 0 findings · 0 notes`], 'text mode: the verdict alone');
  assert.deepEqual((await lint(root)).out, r.out, 'deterministic: a second run prints the same bytes');
  assert.equal(snapshot(root), before, '--lint writes nothing');
}

// ===================================================================================== map: the engine's validators
{
  let root = project();
  editMap(root, (v) => { v.markers = { '.x-cards': { emitter: 'block:cards' } }; });
  let r = await only(root, 'map', /markers: an ARRAY/);
  assert.equal(r.report.notes.length, 1, 'an invalid map skips the other checks, with a note');
  root = project();
  editMap(root, (v) => { v.archetype = 'guides-beta'; });
  await only(root, 'map', /archetype.*guides-beta.*guides-alpha/);
  root = project();
  editMap(root, (v) => { delete v.archetype; });
  await only(root, 'map', /archetype/);
}

// ===================================================================================== inputs: recorded shas
{
  let root = project();
  editText(root, CAPTURE(A), '</body></html>', '</body></html>\n<!-- recaptured -->');
  const now = sha(readFileSync(join(root, ...CAPTURE(A))));
  let r = await only(root, 'inputs', /inputs\.capture\.sha/);
  assert.ok(r.text.includes(now), 'the finding names the sha to record');
  root = project();
  editMap(root, (v) => { delete v.inputs; });
  r = await only(root, 'inputs', /inputs\.capture/);
  assert.ok(/edsSchema/.test(r.text) && /units/.test(r.text), 'an existing optional input must be recorded too');
  // a recorded optional input that is gone is a note; its check is skipped, never failed
  root = project();
  unlinkSync(join(root, 'stardust', 'replica', 'units.json'));
  r = await lint(root);
  assert.equal(r.code, 0, `a missing optional input never fails\n${r.text}`);
  assert.ok(r.report.notes.some((n) => n.check === 'C4' && /units\.json/.test(n.message)), 'C4 is skipped with a note');
}

// ===================================================================================== archetype: capture, encode
{
  let root = project();
  unlinkSync(join(root, ...CAPTURE(A)));
  let r = await lint(root);
  assert.equal(r.code, 1, 'no archetype capture: exit 1');
  assert.ok(r.checks.includes('archetype'), `a finding, not a crash\n${r.text}\n${r.err}`);
  assert.match(r.text, /guides-alpha\.html/);
  // encodeTemplate's UsageError (here: the archetype has no source URL) is a finding too
  root = project();
  writeJ(root, ['stardust', 'current', 'pages', `${A}.json`], { slug: A, title: 'Alpha Route' });
  r = await lint(root);
  assert.equal(r.code, 1);
  assert.ok(r.checks.includes('archetype'), `the encoder's usage error is a lint finding\n${r.text}\n${r.err}`);
  assert.match(r.text, /no source URL/);
  // a stopped archetype (a visible module whose marker has no emitter yet) is a finding
  root = project();
  editMap(root, (v) => { marker(v, '.x-text').emitter = null; });
  r = await lint(root);
  assert.ok(r.checks.includes('archetype') && /unmapped/.test(r.text), `the archetype's stop is a finding\n${r.text}`);
}

// ===================================================================================== C1: forbidden selector forms
{
  const cards = (root, when) => editMap(root, (v) => { marker(v, '.x-cards').variants.push({ when, add: 'lead' }); });
  let root = project(); cards(root, '.x-cards:first-child');
  await only(root, 'C1', /markers\[4\]\.variants\[1\]\.when.*position pseudo-class :first-child/);
  root = project(); cards(root, '#cards-0b1c2d3e4f');
  await only(root, 'C1', /generated id #cards-0b1c2d3e4f/);
  root = project(); cards(root, '.x-cards--featured');
  await only(root, 'C1', /class \.x-cards--featured is on no capture of the template/);
  root = project(); cards(root, ':has(.guide-card)');
  await only(root, 'C1', /eds-schema unitSelector DIV\.guide-card/);
  root = project(); editMap(root, (v) => { marker(v, '.x-faq').sel = '.x-band > .x-faq'; });
  await only(root, 'C1', /markers\[5\]\.sel.*chains through \.x-band/);
  root = project(); editMap(root, (v) => { marker(v, '.x-notice').sel = '.x-grid > .x-notice'; });
  await only(root, 'C1', /markers\[6\]\.sel.*chains through \.x-grid/);
  // :is() / :where() are the selector itself, not a predicate: a chain inside them is still a chain
  for (const sel of [':is(.x-band > .x-faq)', '.x-faq:where(.x-band > *)', ':is(.x-band) > .x-faq']) {
    root = project(); editMap(root, (v) => { marker(v, '.x-faq').sel = sel; });
    await only(root, 'C1', /markers\[5\]\.sel.*chains through \.x-band/);
  }
  // a structural predicate may name a layout class (:has, :not)
  root = project(); editMap(root, (v) => { marker(v, '.x-faq').sel = '.x-faq:not(:has(.x-grid))'; });
  assert.equal((await lint(root)).code, 0, 'a layout class inside :not(:has()) is a predicate, not a chain');
  // a selector the encoder's matcher cannot evaluate is a finding, never a crash; C1 still names its form
  root = project(); editMap(root, (v) => { v.chrome[0] = 'header.site-header:nth-child(2)'; });
  const r = await lint(root);
  assert.deepEqual(r.checks, ['C1', 'archetype'], `${r.text}\n${r.err}`);
  assert.match(r.text, /chrome\[0\].*position pseudo-class :nth-child/); assert.match(r.text, /cannot be prepared: unsupported pseudo-class :nth-child/);
}

// ===================================================================================== C2: dead markers
{
  let root = project();
  editMap(root, (v) => { v.markers.push({ sel: '.x-cards__item.x-grid__col', kind: 'stray', emitter: 'default-content' }); });
  await only(root, 'C2', /markers\[7\].*no first-match hit on the archetype/);
  root = project();
  editMap(root, (v) => { delete marker(v, '.x-notice').evidence; });
  await only(root, 'C2', /markers\[6\].*no evidence/);
  root = project();
  editMap(root, (v) => { marker(v, '.x-notice').evidence = ['guides-beta']; });
  await only(root, 'C2', /no hit on evidence sibling guides-beta/);
  root = project();
  editMap(root, (v) => { marker(v, '.x-notice').evidence = ['guides-omega']; });
  await only(root, 'C2', /guides-omega is not a sibling/);
  root = project();
  editMap(root, (v) => { v.markers.push({ sel: 'div.x-text', kind: 'text-2', emitter: 'default-content' }); });
  const r = await lint(root);
  assert.ok(r.checks.includes('C2') && /shadowed by markers\[3\]/.test(r.text), `a marker every earlier one shadows is dead\n${r.text}`);
}

// ===================================================================================== C3: one first-match marker per module
{
  let root = project();
  editMap(root, (v) => { marker(v, '.x-title:not(:has(h1))').sel = '.x-title'; });
  await only(root, 'C3', /markers\[1\] "\.x-title:has\(h1\)" and markers\[2\] "\.x-title" both match/);
  root = project();
  editMap(root, (v) => { v.markers = v.markers.filter((m) => m.sel !== '.x-text'); });
  await only(root, 'C3', /no marker: div\.x-text/);
  root = project();
  editMap(root, (v) => { marker(v, '.x-text').unique = true; });
  await only(root, 'C3', /unique.*2 matches on guides-alpha/);
  root = project();
  editText(root, CAPTURE('guides-beta'), '<h2 class="x-title__text">Questions</h2>', '<h1 class="x-title__text">Questions</h1>');
  await only(root, 'C3', /unique.*2 matches on guides-beta/);
  // a node the transform drops is never a module: two markers on it are no overlap (the encoder's own drop predicate)
  root = project();
  editText(root, CAPTURE(A), '    <div class="x-text x-grid__col" id="text-2a4c6e8b0d">', '    <div class="x-text x-promo"><p>Members save on guided days.</p></div>\n    <div class="x-text x-grid__col" id="text-2a4c6e8b0d">');
  editMap(root, (v) => { v.markers.unshift({ sel: '.x-promo', kind: 'promo', emitter: 'default-content' }); });
  writeJ(root, ['stardust', 'import', A, 'transform.json'], { imageParagraph: true, emptyP: 'drop', drop: ['.x-promo'] });
  syncInputs(root);
  const dropped = await lint(root);
  assert.equal(dropped.code, 0, `a dropped node raises no overlap\n${dropped.text}`);
}

// ===================================================================================== C4: rows and units.json
{
  const root = project();
  const units = readJ(root, ['stardust', 'replica', 'units.json']);
  units['guide-cards'].origin = '.x-cards__title';
  writeJ(root, ['stardust', 'replica', 'units.json'], units);
  syncInputs(root);
  await only(root, 'C4', /markers\[4\].*rows select 2.*"guide-cards".*selects 2.*0 shared/);
}

// ===================================================================================== C5: variants and styles vs the gated document
{
  let root = project();
  editMap(root, (v) => { marker(v, '.x-cards').variants[0].add = 'dense'; });
  await only(root, 'C5', /block:cards the gated document has variants "compact", the map predicts "dense"/);
  root = project();
  editMap(root, (v) => { marker(v, '.x-band.x-band--muted').emitter = 'section-style:quiet'; });
  await only(root, 'C5', /section style.*"muted".*"quiet"/);
  root = project();
  rmSync(join(root, 'content'), { recursive: true });
  const r = await lint(root);
  assert.equal(r.code, 0, `no gated document: C5 is skipped\n${r.text}`);
  assert.ok(r.report.notes.some((n) => n.check === 'C5'), 'with a note');
}

// ===================================================================================== C6: cell order vs eds-schema roles
{
  let root = project();
  editMap(root, (v) => { const m = marker(v, '.x-cards'); m.cells = [m.cells[2], m.cells[0], m.cells[1]]; });
  await only(root, 'C6', /block cards.*"Packing list" \(cta\) comes before "Pack light" \(heading\).*section "tips"/);
  root = project();
  editMap(root, (v) => { marker(v, '.x-faq').cells[0].as = 'text'; });
  let r = await lint(root);
  assert.ok(r.checks.includes('C6') && /"Is it steep\?" is body text in the block, a heading in the eds-schema/.test(r.text), `a role the block loses\n${r.text}`);
  root = project();
  unlinkSync(join(root, 'stardust', 'eds-schema', `${A}.json`));
  r = await lint(root);
  assert.equal(r.code, 0, `no eds-schema: C6 is skipped\n${r.text}`);
  assert.ok(r.report.notes.some((n) => n.check === 'C6'), 'with a note');
}

// ===================================================================================== --sweep
{
  let root = project();
  let r = await run(root, '--sweep', '--template', A);
  assert.equal(r.code, 0, `the fixture's siblings hold nothing new\n${r.out.join('\n')}\n${r.err}`);
  assert.equal(r.last, `sweep ${A}: 2 siblings · new kinds 0 · unknown modifiers 0 · zero-hit markers 0`);
  root = project();
  editText(root, CAPTURE('guides-beta'), '<div class="x-band', '<div class="x-download x-grid__col"></div>\n    <div class="x-band');
  editText(root, CAPTURE('guides-beta'), 'x-cards x-cards--compact', 'x-cards x-cards--compact x-cards--wide');
  editMap(root, (v) => { v.markers.push({ sel: '.x-cards__item.x-grid__col', kind: 'stray', emitter: 'default-content' }); });
  unlinkSync(join(root, ...CAPTURE('guides-gamma')));
  const before = snapshot(root);
  r = await run(root, '--sweep', '--template', A, '--json');
  assert.equal(r.code, 2, `anything listed exits 2\n${r.out.join('\n')}\n${r.err}`);
  const s = JSON.parse(r.out[0]);
  assert.deepEqual(s.newKinds, [{ slug: 'guides-beta', kind: 'div.x-download', count: 1, visible: false }], 'a new kind, without visible text too');
  assert.deepEqual(s.unknownModifiers, [{ slug: 'guides-beta', marker: 4, sel: '.x-cards', class: 'x-cards--wide' }]);
  assert.deepEqual(s.zeroHit.map((z) => z.marker), [6, 7], 'a marker with no match on any capture swept (the notice lives only on the skipped sibling)');
  assert.ok(s.notes.some((n) => /guides-gamma/.test(n)), 'a sibling with no capture is skipped with a note');
  assert.equal(r.last, `sweep ${A}: 1 sibling · new kinds 1 · unknown modifiers 1 · zero-hit markers 2`);
  assert.equal(snapshot(root), before, '--sweep writes nothing');
  // the census rule: a class-less <div>, <form> or showing <iframe> is a kind (`div.`); class-less plain content and a
  // node the transform drops are not
  root = project();
  editText(root, CAPTURE('guides-beta'), '<div class="x-band', ['<div><p>Ask at the hut.</p></div>', '<form action="/subscribe"><button>Subscribe</button></form>',
    '<iframe src="https://player.example.net/embed/7" title="Route map"></iframe>', '<p>Plain words.</p>', '<div class="x-promo"><p>Members save.</p></div>', '<div class="x-band'].join('\n    '));
  writeJ(root, ['stardust', 'import', A, 'transform.json'], { imageParagraph: true, emptyP: 'drop', drop: ['.x-promo'] });
  r = await run(root, '--sweep', '--template', A, '--json');
  assert.equal(r.code, 2, r.out.join('\n'));
  assert.deepEqual(JSON.parse(r.out[0]).newKinds, [
    { slug: 'guides-beta', kind: 'div.', count: 1, visible: true }, { slug: 'guides-beta', kind: 'form.', count: 1, visible: true },
    { slug: 'guides-beta', kind: 'iframe.', count: 1, visible: true }]);
  root = project();
  editMap(root, (v) => { v.markers = {}; });
  r = await run(root, '--sweep', '--template', A);
  assert.equal(r.code, 1, 'an invalid map: exit 1');
}

// ===================================================================================== the schema and the engine in step
{
  // every $ref resolves
  const refs = []; const walk = (x) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === '$ref') refs.push(v); else walk(v); } };
  walk(SCHEMA);
  for (const ref of refs) { const def = ref.replace(/^#\/\$defs\//, ''); assert.ok(SCHEMA.$defs[def], `${ref} resolves`); }
  const D = SCHEMA.$defs;
  const props = { vocabulary: SCHEMA.properties, marker: D.marker.properties, variant: D.variant.properties, rowGroup: D.rowGroup.properties, cellSpec: D.cellSpecKeys.properties, cellsEach: D.cellsEach.properties, transform: D.transform.properties, accept: D.variance.properties.accept.items.properties, ignoreAncestors: D.variance.properties.ignoreAncestors.items.properties, childClass: D.moduleSelector.oneOf[1].properties, class: D.moduleSelector.oneOf[2].properties, variance: D.variance.properties };

  // one probe per schema key: a wrong value the engine must reject naming the key ('reject'), or a key the engine
  // accepts unread because --lint owns it ('lint', x-lint in the schema); plus, per object, an unknown key the engine
  // must reject (R29: the engine is strict, the schema says additionalProperties: false)
  const V = (x = {}) => ({ root: 'main', markers: [{ sel: '.a', emitter: 'block:a' }], ...x });
  const M = (x) => V({ markers: [{ sel: '.a', emitter: 'block:a', ...x }] });
  const C = (x) => M({ cells: [x] });
  const T = (x) => ({ transform: x });
  const AC = (x) => V({ variance: { accept: [{ print: 'p', on: 'extra', reason: 'r', ...x }] } });
  const IA = (x) => V({ variance: { ignoreAncestors: [{ class: '^grid', reason: 'r', ...x }] } });
  const PROBES = {
    vocabulary: {
      $comment: ['reject', V({ $comment: 42 })], $schema: ['lint', V({ $schema: 42 })], archetype: ['lint', V({ archetype: 42 })], inputs: ['lint', V({ inputs: 42 })],
      root: ['reject', V({ root: 42 })], chrome: ['reject', V({ chrome: '.x' })], wrappers: ['reject', V({ wrappers: '.x' })],
      moduleSelectors: ['reject', V({ moduleSelectors: '.x' })], sectionTags: ['reject', V({ sectionTags: ['Section!'] })],
      walkSiblings: ['reject', V({ walkSiblings: 'yes' })], requireH1: ['reject', V({ requireH1: 'no' })],
      ignoreModifiers: ['reject', V({ ignoreModifiers: ['('] })], metadata: ['reject', V({ metadata: [['Title']] })],
      variance: ['reject', V({ variance: 42 })], markers: ['reject', V({ markers: { '.a': {} } })],
      zzz: ['unknown', V({ zzz: 1 })],
    },
    marker: {
      $comment: ['reject', M({ $comment: 42 })], sel: ['reject', M({ sel: 42 })], kind: ['reject', M({ kind: 42 })], emitter: ['reject', M({ emitter: 'none' })],
      style: ['reject', M({ emitter: 'section', style: 42 })], sectionBefore: ['reject', M({ sectionBefore: 'yes' })],
      sectionAfter: ['reject', M({ sectionAfter: 'yes' })], sectionStyle: ['reject', M({ sectionStyle: 42 })],
      variants: ['reject', M({ variants: '.x' })], merge: ['reject', M({ merge: 'no' })], retag: ['reject', M({ retag: 'b' })],
      drop: ['reject', M({ drop: '.x' })], rows: ['reject', M({ rows: 42 })], cells: ['reject', M({ cells: 42 })],
      evidence: ['lint', M({ evidence: 42 })], unique: ['lint', M({ unique: 'yes' })], zzz: ['unknown', M({ zzz: 1 })],
    },
    variant: {
      $comment: ['reject', M({ variants: [{ when: '.x', add: 'x', $comment: 42 }] })], when: ['reject', M({ variants: [{ when: 42, add: 'x' }] })],
      add: ['reject', M({ variants: [{ when: '.x', add: 'Not A Token' }] })], zzz: ['unknown', M({ variants: [{ when: '.x', add: 'x', zzz: 1 }] })],
    },
    rowGroup: {
      $comment: ['reject', M({ rows: [{ sel: '.r', $comment: 42 }] })], sel: ['reject', M({ rows: [{ sel: 42 }] })], cells: ['reject', M({ rows: [{ sel: '.r', cells: 42 }] })],
      optional: ['reject', M({ rows: [{ sel: '.r', optional: 'yes' }] })], max: ['reject', M({ rows: [{ sel: '.r', max: 0 }] })],
      zzz: ['unknown', M({ rows: [{ sel: '.r', zzz: 1 }] })],
    },
    cellSpec: {
      $comment: ['reject', C({ $comment: 42 })], sel: ['reject', C({ sel: 42 })], as: ['reject', C({ as: 'bogus' })], all: ['reject', C({ all: 'yes' })], wrap: ['reject', C({ wrap: 42 })],
      itemWrap: ['reject', C({ itemWrap: 'P!' })], join: ['reject', C({ join: 42 })], optional: ['reject', C({ optional: 'maybe' })],
      selfOk: ['reject', C({ selfOk: 'yes' })], retag: ['reject', C({ retag: 'b' })], drop: ['reject', C({ drop: '.x' })],
      attr: ['reject', C({ as: 'attr', attr: 42 })], then: ['reject', C({ as: 'idref', then: 'html' })], text: ['reject', C({ as: 'link', text: 42 })],
      titleAttr: ['reject', C({ as: 'link', titleAttr: 42 })], value: ['reject', C({ as: 'literal', value: 42 })], parts: ['reject', C({ parts: [] })],
      zzz: ['unknown', C({ zzz: 1 })],
    },
    cellsEach: { each: ['reject', M({ cells: { each: 42 } })], zzz: ['unknown', M({ cells: { each: '.x', zzz: 1 } })] },
    variance: {
      $comment: ['reject', V({ variance: { $comment: 42 } })], accept: ['reject', V({ variance: { accept: 'p' } })],
      ignoreAncestors: ['reject', V({ variance: { ignoreAncestors: 'grid' } })], zzz: ['unknown', V({ variance: { zzz: 1 } })],
    },
    accept: {
      $comment: ['reject', AC({ $comment: 42 })], print: ['reject', AC({ print: 42 })], on: ['reject', AC({ on: 'sometimes' })],
      reason: ['reject', AC({ reason: ' ' })], zzz: ['unknown', AC({ zzz: 1 })],
    },
    ignoreAncestors: {
      $comment: ['reject', IA({ $comment: 42 })], class: ['reject', IA({ class: '(' })], reason: ['reject', IA({ reason: '' })], zzz: ['unknown', IA({ zzz: 1 })],
    },
    childClass: { $comment: ['reject', V({ moduleSelectors: [{ childClass: '^x', $comment: 42 }] })], childClass: ['reject', V({ moduleSelectors: [{ childClass: '(' }] })], zzz: ['unknown', V({ moduleSelectors: [{ childClass: '^x', zzz: 1 }] })] },
    class: { $comment: ['reject', V({ moduleSelectors: [{ class: '^x', $comment: 42 }] })], class: ['reject', V({ moduleSelectors: [{ class: '(' }] })], zzz: ['unknown', V({ moduleSelectors: [{ class: '^x', zzz: 1 }] })] },
    transform: {
      $comment: ['reject', T({ $comment: 42 })], imageParagraph: ['reject', T({ imageParagraph: 'yes' })], imgAttrs: ['reject', T({ imgAttrs: ['srcset'] })],
      retag: ['reject', T({ retag: { b: 'B!' } })], headingsByClass: ['reject', T({ headingsByClass: 'x' })], drop: ['reject', T({ drop: '.x' })],
      keepHashLinks: ['reject', T({ keepHashLinks: 'yes' })], emptyP: ['reject', T({ emptyP: 'maybe' })], zzz: ['unknown', T({ zzz: 1 })],
    },
  };
  for (const [def, table] of Object.entries(PROBES)) {
    const keys = Object.keys(table).filter((k) => table[k][0] !== 'unknown');
    assert.deepEqual(keys.sort(), Object.keys(props[def]).sort(), `${def}: one probe per schema key, no probe for a key the schema lacks`);
    for (const [key, [expect, probe]] of Object.entries(table)) {
      const errs = probe.transform ? validateTransform(probe.transform) : validateVocabulary(probe);
      if (expect === 'unknown') { assert.ok(errs.some((e) => e.includes(key)), `${def}: the engine rejects an unknown key, naming it (got ${JSON.stringify(errs)})`); continue; }
      assert.equal(Boolean(props[def][key]['x-lint']), expect === 'lint', `${def}.${key}: x-lint in the schema ⇔ the key is --lint's`);
      if (expect === 'reject') assert.ok(errs.some((e) => e.includes(key)), `${def}.${key}: the engine rejects ${JSON.stringify(probe)} naming the key (got ${JSON.stringify(errs)})`);
      else assert.deepEqual(errs, [], `${def}.${key} (${expect}): the engine accepts it unread`);
    }
  }
  // the base probes are valid, and so is every value the schema's enums allow
  assert.deepEqual(validateVocabulary(V()), []);
  for (const as of D.cellSpecKeys.properties.as.enum) assert.deepEqual(validateVocabulary(C({ as, ...(as === 'literal' ? { value: 'v' } : as === 'attr' ? { attr: 'href' } : {}) })), [], `cell mode ${as}`);
  const modes = /use ([a-z|]+)/.exec(validateVocabulary(C({ as: 'bogus' })).join(' '))[1].split('|').sort();
  assert.deepEqual(modes, [...D.cellSpecKeys.properties.as.enum].sort(), 'the cell modes the engine names = the schema enum');
  for (const on of D.variance.properties.accept.items.properties.on.enum) assert.deepEqual(validateVocabulary(V({ variance: { accept: [{ print: 'p', on, reason: 'r' }] } })), [], `accept on ${on}`);
  for (const emptyP of D.transform.properties.emptyP.enum) assert.deepEqual(validateTransform({ emptyP }), []);
  for (const then of D.cellSpecKeys.properties.then.enum) assert.deepEqual(validateVocabulary(C({ as: 'idref', then })), []);
  const EMITTER = new RegExp(D.emitter.anyOf[0].pattern);
  for (const e of ['block:cards', 'block:cards wide dark', 'block:Cards', 'block:', 'section', 'section-style:dark, wide', 'section-style:', 'section-break:rule', 'drop:a runtime form', 'drop:', 'dynamics:DYN-1', 'wrapper', 'default-content', 'none', 'block:cards  wide', 'sections']) {
    assert.equal(validateVocabulary(M({ emitter: e })).length === 0, EMITTER.test(e), `emitter "${e}": the schema pattern and the engine agree`);
  }
  assert.deepEqual(validateVocabulary(M({ emitter: null })), [], 'a null emitter is valid (a known kind, not mapped yet)');

  // the engine → schema direction: each kind's key set (engine KEYS, what the validators enforce) equals the schema
  // definition's properties minus $comment, which every definition documents; LINT_KEYS ⇔ x-lint. `patch` is the
  // patches file's (stardust/patches/<slug>.json), not the map's.
  const defs = { ...props, cellsEach: { ...D.cellSpecKeys.properties, ...D.cellsEach.properties } };
  assert.deepEqual(Object.keys(KEYS).filter((k) => k !== 'patch').sort(), Object.keys(defs).sort(), 'one schema definition per engine kind');
  for (const [def, p] of Object.entries(defs)) {
    assert.ok(p[COMMENT_KEY], `${def}: the schema documents ${COMMENT_KEY}`);
    assert.deepEqual(Object.keys(p).filter((k) => k !== COMMENT_KEY).sort(), [...KEYS[def]].sort(), `${def}: the schema's keys = the engine's KEYS.${def}`);
    assert.deepEqual(Object.keys(p).filter((k) => p[k]['x-lint']).sort(), [...(LINT_KEYS[def] || [])].sort(), `${def}: x-lint = LINT_KEYS.${def}`);
  }

  // every key the fixture maps use is a schema key (the encoder's own fixture exercises every grammar v2 feature)
  const keysOk = (obj, def, where) => { for (const k of Object.keys(obj)) assert.ok(props[def][k], `${where}.${k} is in the schema (${def})`); };
  const cellsOk = (cells, where) => {
    if (Array.isArray(cells)) cells.forEach((c, i) => { keysOk(c, 'cellSpec', `${where}[${i}]`); if (c.parts) cellsOk(c.parts, `${where}[${i}].parts`); });
    else if (cells) { const { each, ...spec } = cells; keysOk({ each }, 'cellsEach', where); keysOk(spec, 'cellSpec', where); }
  };
  const maps = [join(HERE, 'fixtures', 'encode', 'stardust', 'import', 'trips-river-walk'), join(FX, 'stardust', 'import', A)];
  for (const dir of maps) {
    const v = JSON.parse(readFileSync(join(dir, 'vocabulary.json'), 'utf8'));
    assert.deepEqual(validateVocabulary(v), [], `${dir}: a valid map`);
    keysOk(v, 'vocabulary', 'vocabulary');
    for (const a of v.variance?.accept || []) keysOk(a, 'accept', 'variance.accept[]');
    v.markers.forEach((m, i) => {
      keysOk(m, 'marker', `markers[${i}]`);
      for (const x of m.variants || []) keysOk(x, 'variant', `markers[${i}].variants[]`);
      if (Array.isArray(m.rows)) m.rows.forEach((g, j) => { keysOk(g, 'rowGroup', `markers[${i}].rows[${j}]`); cellsOk(g.cells, `markers[${i}].rows[${j}].cells`); });
      cellsOk(m.cells, `markers[${i}].cells`);
    });
    const tfile = join(dir, 'transform.json');
    if (existsSync(tfile)) { const tf = JSON.parse(readFileSync(tfile, 'utf8')); assert.deepEqual(validateTransform(tf), []); keysOk(tf, 'transform', 'transform'); }
  }
}
console.log('encode-lint: ok');
