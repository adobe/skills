#!/usr/bin/env node
// skills/rollout/scripts/test/workspace-manifest.test.mjs — the workspace-manifest.mjs contract
// (reference/coverage-contract.md): on the delivered-site fixture, coverage is built the way a run
// builds it (inventory.mjs → blocks.mjs → conversions recorded with update-coverage.mjs → blocks.mjs),
// then the manifest: it validates against its schema; outputs hash the three coverage files (and
// workspace/mapping.json when present) and inputs the content, the block code and the judgement;
// byte-identical re-runs and a --dry-run that writes nothing; a temp-file write that leaves nothing
// behind on failure; exit 1 without coverage,
// without formatVersion or on stale coverage; handover (marker, untracked content, --force +
// degraded, a second forced run keeping the first handover); the judgement draft; placeholders;
// exit 2 on usage errors; --help writes nothing; no identity in the manifest or the draft; a project
// moved after coverage was built with absolute flags is not stale. The mapping is required once
// captures exist: without workspace/mapping.json the manifest is written without handover, the
// missing line is printed and the exit is 2 (--allow-no-mapping and a project without captures keep
// handover null, exit 0). A block is pending only with delivered instances and no conversion record
// (pendingBlocks; one placeholders line). Also the
// identity helpers in lib.mjs (patterns, tokens, linear time). Every run works on a copy in a temp
// dir, never inside a repository unless a check makes one.
// Run: node plugins/stardust/skills/rollout/scripts/test/workspace-manifest.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, unsupported, validate } from './schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const SCRIPT = join(SCRIPTS, 'workspace-manifest.mjs');
const FIXTURE = join(HERE, 'fixtures', 'delivered-site');
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'rollout-workspace-manifest-test-')));
// git never looks above ROOT: a copy is a repository only when a check makes it one.
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: ROOT };

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e && e.message).split('\n').join('\n  ')}`); } };
// Imported as namespaces so a missing export fails its own checks, not the whole file.
const lib = await import('../lib.mjs').catch((e) => { console.log(`(../lib.mjs did not load: ${e.message})`); return {}; });
const wm = await import('../workspace-manifest.mjs').catch((e) => { console.log(`(../workspace-manifest.mjs did not load: ${e.message})`); return {}; });

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha = (data) => `sha256:${createHash('sha256').update(data).digest('hex')}`;
const node = (cwd, script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd, encoding: 'utf8', env: ENV });
const ok = (r, code = 0) => assert.equal(r.status, code, `exit ${r.status}, want ${code}\n  stdout: ${(r.stdout || '').trim().slice(0, 600)}\n  stderr: ${(r.stderr || '').trim().slice(0, 600)}`);
const OUT = (dir) => join(dir, 'stardust', 'rollout');
const W = (dir) => join(OUT(dir), 'workspace');
const COV = ['blocks', 'pages', 'templates'].map((n) => `stardust/rollout/coverage/${n}.json`);
const run = (dir, ...args) => node(dir, 'workspace-manifest.mjs', ...args);
const text = (dir, f) => readFileSync(join(W(dir), f), 'utf8');
const doc = (dir, f) => JSON.parse(text(dir, f));
const jsonOut = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`--json stdout is not one JSON object: ${r.stdout.slice(0, 300)}`); } };
const editJSON = (p, fn) => { const d = JSON.parse(readFileSync(p, 'utf8')); fn(d); writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`); };
const editText = (p, from, to) => { const t = readFileSync(p, 'utf8'); assert.ok(t.includes(from), `${from} not in ${p}`); writeFileSync(p, t.replace(from, to)); };
const snapshot = (d) => (existsSync(d) ? Object.fromEntries(readdirSync(d).sort(byStr).map((f) => [f, statSync(join(d, f)).isDirectory() ? '<dir>' : readFileSync(join(d, f), 'utf8')])) : null);
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
// The installed plugin's version, found the way the script does (a hidden `.<name>-plugin` dir).
const pluginVersion = () => {
  for (let d = SCRIPTS, i = 0; i <= 5; d = dirname(d), i += 1) {
    for (const n of readdirSync(d).filter((x) => /^\.[a-z]+-plugin$/.test(x))) {
      try { const m = JSON.parse(readFileSync(join(d, n, 'plugin.json'), 'utf8')); if (m.name === 'stardust') return m.version; } catch { /* next */ }
    }
  }
  return null;
};

// Coverage as a run builds it: module ids mapped to their EDS block names between two blocks.mjs runs.
const CONVERSIONS = [['hero-banner', 'hero'], ['link-list', 'teaser'], ['three-up', 'columns']];
const buildCoverage = (dir, ...inventoryArgs) => [
  node(dir, 'inventory.mjs', ...inventoryArgs),
  node(dir, 'blocks.mjs'),
  ...CONVERSIONS.map(([id, name]) => node(dir, 'update-coverage.mjs', '--block', id, '--status', 'converted', '--eds-name', name)),
  node(dir, 'blocks.mjs'),
];
// What a run re-runs after content or judgement changes (blocks.mjs keeps the recorded conversions).
const rebuild = (dir, ...inventoryArgs) => [node(dir, 'inventory.mjs', ...inventoryArgs), node(dir, 'blocks.mjs')].forEach((r) => ok(r));
const BASE = join(ROOT, 'base');
cpSync(FIXTURE, BASE, { recursive: true });
// The checks below run as a project without captures (no mapping needed); withCaptures() puts the fixture's back.
const CAPTURES = join('stardust', 'current');
rmSync(join(BASE, CAPTURES), { recursive: true, force: true });
const setup = buildCoverage(BASE);
const copy = (label) => { const dir = mkdtempSync(join(ROOT, `${label}-`)); cpSync(BASE, dir, { recursive: true }); return dir; };
const withCaptures = (label) => { const dir = copy(label); cpSync(join(FIXTURE, CAPTURES), join(dir, CAPTURES), { recursive: true }); return dir; };
const MAP = 'stardust/rollout/workspace/mapping.json';
const MISSING = 'missing: stardust/rollout/workspace/mapping.json — run block-origin.mjs --verify first';
const mappingDoc = (generatedAt) => `${JSON.stringify({ formatVersion: '0.1.0', generatedAt, templates: [] }, null, 2)}\n`;
const gitCopy = (label) => {
  const dir = copy(label);
  git(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/fixture-owner/fixture-repo.git');
  return dir;
};
const NEEDLES = ['fixture-org', 'fixture-site', 'fixture-owner', 'aem.page', 'aem.live', 'content.da.live'];
const leaks = (s, needles = NEEDLES) => needles.filter((n) => s.toLowerCase().includes(n.toLowerCase()));
const BASE_PLACEHOLDERS = [
  'blocks[].baseType: 1 block(s) unknown (not judged)',
  'blocks[].purpose: 4 block(s) without purpose (not judged)',
  'blocks[].reuseGuidance: 4 block(s) without reuse guidance (not judged)',
  'templates[].description: 2 template(s) without a description (not judged)',
  'templates[].name: 2 template(s) without a name (not judged)',
];

check('setup: inventory.mjs, blocks.mjs and update-coverage.mjs build coverage 0.1.0 from the delivered-site fixture', () => {
  setup.forEach((r) => ok(r));
  for (const f of COV) assert.equal(JSON.parse(readFileSync(join(BASE, f), 'utf8')).formatVersion, '0.1.0', f);
});

check('schema: manifest.json validates against rollout-workspace-manifest.schema.json (formatVersion 0.1.0), the judgement draft against rollout-workspace-judgement.schema.json; the validator is not vacuous', () => {
  const schema = loadSchema('rollout-workspace-manifest.schema.json');
  const judgementSchema = loadSchema('rollout-workspace-judgement.schema.json');
  assert.deepEqual([...unsupported(schema), ...unsupported(judgementSchema)], [], 'the schemas use only the keyword subset the validator checks');
  const dir = copy('schema');
  ok(run(dir));
  const mf = doc(dir, 'manifest.json');
  assert.equal(mf.formatVersion, '0.1.0');
  // the fixture's teaser has no judged base type, so the manifest carries handoverNotes (unknown is not judged)
  assert.deepEqual(Object.keys(mf), ['_provenance', 'formatVersion', 'inputs', 'outputs', 'placeholders', 'handover', 'handoverNotes']);
  assert.deepEqual(mf.handoverNotes, ['1 delivered block(s) have no judged base type; the owner names them (teaser)']);
  assert.deepEqual(validate(schema, mf), []);
  const broken = JSON.parse(JSON.stringify(mf));
  broken.outputs[COV[0]] = 'sha256:xyz';
  delete broken.placeholders;
  const errors = validate(schema, broken);
  assert.ok(errors.some((e) => /missing required placeholders/.test(e)) && errors.some((e) => /does not match/.test(e)), errors.join('\n'));
  ok(run(dir, '--draft-judgement'));
  assert.deepEqual(validate(judgementSchema, doc(dir, 'judgement.json')), []);
});

check('hashes: outputs are the three coverage files, inputs the content summary, every block code file and the judgement; each value is the sha256 of the bytes; provenance from coverage', () => {
  const dir = copy('hashes');
  const r = run(dir, '--json');
  ok(r);
  const mf = doc(dir, 'manifest.json');
  assert.equal(jsonOut(r).hashes['manifest.json'], sha(text(dir, 'manifest.json')));
  assert.deepEqual(Object.keys(mf.outputs), COV);
  for (const f of COV) assert.equal(mf.outputs[f], sha(readFileSync(join(dir, f))), f);
  const code = walk(join(dir, 'blocks')).map((p) => relative(dir, p)).filter((p) => /^blocks\/([^/]+)\/\1\.(js|css)$/.test(p));
  assert.ok(code.length >= 6, `block code files: ${code}`);
  assert.deepEqual(Object.keys(mf.inputs), [...code, 'content'].sort(byStr), 'input keys: block code + content, sorted');
  for (const f of code) assert.equal(mf.inputs[f], sha(readFileSync(join(dir, f))), f);
  const docs = walk(join(dir, 'content')).filter((p) => p.endsWith('.html'));
  const lines = docs.map((p) => `${relative(dir, p)} ${sha(readFileSync(p))}\n`).sort(byStr);
  assert.deepEqual(mf.inputs.content, { files: docs.length, sha256: sha(lines.join('')), tracked: null }, 'one hash over sorted "path sha" lines; not a repository');
  const pv = mf._provenance;
  const pages = JSON.parse(readFileSync(join(dir, COV[1]), 'utf8'));
  assert.deepEqual([pv.writtenBy, pv.writtenAt, pv.stardustVersion], ['stardust:rollout/workspace-manifest', pages.generatedAt, pluginVersion()]);
  assert.deepEqual(pv.readArtifacts, ['blocks', 'content', ...COV]);
  ok(run(dir, '--draft-judgement'));
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  const j = doc(dir, 'manifest.json');
  assert.equal(j.inputs['stardust/rollout/workspace/judgement.json'], sha(text(dir, 'judgement.json')), 'the judgement is an input');
  assert.ok(j._provenance.readArtifacts.includes('stardust/rollout/workspace/judgement.json'));
});

check('mapping: a workspace/mapping.json file is hashed under outputs (and so in readArtifacts), nothing else changes; without it (or as a directory) outputs hold only the coverage; new bytes rewrite the manifest; it validates', () => {
  const MAP = 'stardust/rollout/workspace/mapping.json';
  const mapping = (generatedAt) => `${JSON.stringify({ formatVersion: '0.1.0', generatedAt, templates: [] }, null, 2)}\n`;
  const dir = copy('mapping');
  ok(run(dir));
  const without = doc(dir, 'manifest.json');
  assert.deepEqual(Object.keys(without.outputs), COV, 'without mapping.json: only the three coverage files');
  mkdirSync(join(dir, MAP));
  assert.equal(jsonOut(run(dir, '--json')).status, 'unchanged', 'a directory named mapping.json is not listed');
  rmSync(join(dir, MAP), { recursive: true });
  writeFileSync(join(dir, MAP), mapping('2026-01-01T00:00:00.000Z'));
  const r = run(dir, '--json');
  ok(r);
  assert.equal(jsonOut(r).status, 'written');
  const mf = doc(dir, 'manifest.json');
  assert.deepEqual(Object.keys(mf.outputs), [...COV, MAP], 'outputs keys sorted, mapping.json after the coverage');
  assert.equal(mf.outputs[MAP], sha(readFileSync(join(dir, MAP))));
  const expected = JSON.parse(JSON.stringify(without));
  expected.outputs[MAP] = mf.outputs[MAP];
  expected._provenance.readArtifacts = [...without._provenance.readArtifacts, MAP].sort(byStr);
  // an empty-templates mapping now adds a zeroed selectorQuality block and an empty sectionGaps (derived from mapping.json, not drift inputs)
  expected.selectorQuality = { instances: 0, sources: { encoderMap: 0, textAlignment: 0, position: 0 }, encoderCoverage: 0, zeroConfidence: 0, zeroConfidenceBlocks: [] };
  expected.sectionGaps = [];
  assert.deepEqual(mf, expected, 'the only change is the outputs entry, its readArtifacts line and the derived selectorQuality and sectionGaps');
  assert.deepEqual(validate(loadSchema('rollout-workspace-manifest.schema.json'), mf), []);
  assert.equal(jsonOut(run(dir, '--json')).status, 'unchanged');
  writeFileSync(join(dir, MAP), mapping('2026-01-02T00:00:00.000Z'));
  const again = run(dir, '--json');
  ok(again);
  assert.equal(jsonOut(again).status, 'written', 'changed mapping.json bytes change the manifest');
  assert.equal(doc(dir, 'manifest.json').outputs[MAP], sha(readFileSync(join(dir, MAP))));
});

check('selectorQuality: derived from mapping.json (mixed sources) — sources, encoderCoverage (3 dp), zeroConfidence and the top blocks; zero on an empty mapping; recomputed by --rehash-only; --check never counts it as drift; validates', () => {
  const mixedMapping = {
    formatVersion: '0.1.0', generatedAt: '2026-01-01T00:00:00.000Z', skipped: [],
    templates: [{
      id: 't1', sections: [],
      blocks: [
        { block: 'hero', instances: [{ slug: 'a', pos: 0, selector: 'h', source: 'encoder-map', confidence: 1, verified: null }] },
        { block: 'cards', instances: [{ slug: 'a', pos: 1, selector: 'c1', source: 'text-alignment', confidence: 0.6, verified: null }, { slug: 'b', pos: 2, selector: 'c2', source: 'text-alignment', confidence: 0.4, verified: null }] },
        { block: 'media', instances: [{ slug: 'a', pos: 3, selector: 'm1', source: 'position', confidence: 0, verified: null }, { slug: 'b', pos: 4, selector: 'm2', source: 'position', confidence: 0, verified: null }] },
        { block: 'gallery', instances: [{ slug: 'a', pos: 5, selector: 'g1', source: 'position', confidence: 0, verified: null }] },
      ],
    }],
  };
  const MIXED = { instances: 6, sources: { encoderMap: 1, textAlignment: 2, position: 3 }, encoderCoverage: 0.167, zeroConfidence: 3, zeroConfidenceBlocks: [{ block: 'media', instances: 2 }, { block: 'gallery', instances: 1 }] };
  const dir = withCaptures('selector-quality');
  mkdirSync(W(dir), { recursive: true });
  writeFileSync(join(dir, MAP), `${JSON.stringify(mixedMapping, null, 2)}\n`);
  ok(run(dir));
  assert.deepEqual(doc(dir, 'manifest.json').selectorQuality, MIXED);
  assert.deepEqual(validate(loadSchema('rollout-workspace-manifest.schema.json'), doc(dir, 'manifest.json')), []);
  // --check compares inputs/outputs only; the derived selectorQuality is never a drift
  const c = run(dir, '--check', '--json');
  ok(c, 0);
  assert.equal(jsonOut(c).status, 'fresh');
  assert.deepEqual(jsonOut(c).drifted, []);
  // --rehash-only recomputes it (not a carry-over): corrupt the field, re-hash, it comes back right
  editJSON(join(W(dir), 'manifest.json'), (m) => { m.selectorQuality.zeroConfidence = 999; });
  ok(run(dir, '--rehash-only'), 0);
  assert.equal(doc(dir, 'manifest.json').selectorQuality.zeroConfidence, 3, 'derived, recomputed from the mapping');
  // an empty mapping → all zeros
  writeFileSync(join(dir, MAP), mappingDoc('2026-01-01T00:00:00.000Z'));
  ok(run(dir));
  assert.deepEqual(doc(dir, 'manifest.json').selectorQuality, { instances: 0, sources: { encoderMap: 0, textAlignment: 0, position: 0 }, encoderCoverage: 0, zeroConfidence: 0, zeroConfidenceBlocks: [] });
});

check('sectionGaps: derived from mapping.json — two null-selector sections and one whose blocks are unprojected, with the dropped block names; the handover notes carry the counts; none → empty list and no sentence; recomputed by --rehash-only; --check never counts it as drift; validates', () => {
  // s1 keeps hero+promo (both home to it); s2/s4 have no selector; s3 keeps its selector but promo homed to s1, so it is lost.
  const gapMapping = {
    formatVersion: '0.1.0', generatedAt: '2026-01-01T00:00:00.000Z', skipped: [],
    templates: [{
      templateId: 't1',
      sections: [
        { id: 's1', selector: 'h1', pages: ['home'], style: null, blocks: ['hero', 'promo'], defaultContent: [], confidence: 1 },
        { id: 's2', selector: null, pages: [], style: null, blocks: ['cards'], defaultContent: [], confidence: 0 },
        { id: 's3', selector: 'section.x', pages: ['home'], style: null, blocks: ['promo'], defaultContent: [], confidence: 1 },
        { id: 's4', selector: null, pages: [], style: null, blocks: [], defaultContent: [], confidence: 0 },
      ],
      blocks: [
        { block: 'hero', variant: null, variantId: 'v_hero', section: 's1', positions: [0], instances: [{ slug: 'home', pos: 0, selector: 'h1 a', confidence: 1, source: 'text-alignment', verified: null }] },
        { block: 'promo', variant: null, variantId: 'v_promo', section: 's1', positions: [1], instances: [{ slug: 'home', pos: 1, selector: 'p1', confidence: 1, source: 'text-alignment', verified: null }] },
        { block: 'promo', variant: null, variantId: 'v_promo', section: 's3', positions: [2], instances: [{ slug: 'home', pos: 2, selector: 'p2', confidence: 1, source: 'text-alignment', verified: null }] },
      ],
    }],
  };
  const EXPECTED = [
    { page: 't1', template: 't1', section: 's2', reason: 'no-selector', blocks: ['cards'] },
    { page: 'home', template: 't1', section: 's3', reason: 'blocks-unprojected', blocks: ['promo'] },
    { page: 't1', template: 't1', section: 's4', reason: 'no-selector', blocks: [] },
  ];
  const dir = withCaptures('section-gaps');
  mkdirSync(W(dir), { recursive: true });
  writeFileSync(join(dir, MAP), `${JSON.stringify(gapMapping, null, 2)}\n`);
  ok(run(dir));
  const mf = doc(dir, 'manifest.json');
  assert.deepEqual(mf.sectionGaps, EXPECTED);
  // the counts ride the handover notes (two null-selector, one blocks-unprojected)
  assert.deepEqual((mf.handoverNotes || []).filter((n) => n.includes('selector')), [
    '2 section(s) have no source selector; an adopter projecting per selector drops them — see sectionGaps',
    '1 section(s) keep their selector but lose their blocks to a per-selector projection — see sectionGaps',
  ]);
  assert.deepEqual(validate(loadSchema('rollout-workspace-manifest.schema.json'), mf), []);
  // --check compares inputs/outputs only; the derived sectionGaps is never a drift
  const c = run(dir, '--check', '--json');
  ok(c, 0);
  assert.equal(jsonOut(c).status, 'fresh');
  // --rehash-only recomputes it (not a carry-over): corrupt the field, re-hash, it comes back right
  editJSON(join(W(dir), 'manifest.json'), (m) => { m.sectionGaps = [{ page: 'x', template: 'x', section: 'x', reason: 'no-selector', blocks: [] }]; });
  ok(run(dir, '--rehash-only'), 0);
  assert.deepEqual(doc(dir, 'manifest.json').sectionGaps, EXPECTED, 'derived, recomputed from the mapping');
  // none → empty list and no handover sentence
  writeFileSync(join(dir, MAP), mappingDoc('2026-01-01T00:00:00.000Z'));
  ok(run(dir));
  const clean = doc(dir, 'manifest.json');
  assert.deepEqual(clean.sectionGaps, []);
  assert.ok(!(clean.handoverNotes || []).some((n) => n.includes('selector')), JSON.stringify(clean.handoverNotes));
});

check('mapping required: captures present and no mapping.json → the manifest is written without handover, the missing line names block-origin.mjs --verify, exit 2; unchanged on a re-run, still 2; --dry-run writes nothing', () => {
  const dir = withCaptures('needs-mapping');
  const r = run(dir);
  ok(r, 2);
  assert.ok(r.stderr.split('\n').includes(MISSING), r.stderr);
  const mf = doc(dir, 'manifest.json');
  assert.equal(Object.hasOwn(mf, 'handover'), false, 'no handover key while the mapping is missing');
  assert.deepEqual(Object.keys(mf.outputs), COV);
  assert.deepEqual(validate(loadSchema('rollout-workspace-manifest.schema.json'), mf), []);
  const again = run(dir, '--json');
  ok(again, 2);
  assert.equal(jsonOut(again).status, 'unchanged');
  assert.deepEqual(jsonOut(again).missing, [MAP]);
  const dry = withCaptures('needs-mapping-dry');
  const d = run(dry, '--dry-run');
  ok(d, 2);
  assert.ok(d.stderr.includes(MISSING), d.stderr);
  assert.equal(existsSync(W(dry)), false, '--dry-run created the workspace dir');
  ok(run(withCaptures('needs-mapping-draft'), '--draft-judgement'), 0);
});

check('mapping required: with mapping.json the manifest carries handover null and exits 0; captures holding only <slug>.json count; --captures points at the capture dir', () => {
  const dir = withCaptures('has-mapping');
  mkdirSync(W(dir), { recursive: true });
  writeFileSync(join(dir, MAP), mappingDoc('2026-01-01T00:00:00.000Z'));
  const r = run(dir, '--json');
  ok(r);
  assert.deepEqual(jsonOut(r).missing, []);
  assert.equal(doc(dir, 'manifest.json').handover, null);
  const jsonOnly = withCaptures('json-captures');
  for (const f of readdirSync(join(jsonOnly, CAPTURES, 'pages')).filter((n) => n.endsWith('.html'))) rmSync(join(jsonOnly, CAPTURES, 'pages', f));
  ok(run(jsonOnly), 2);
  const moved = copy('captures-flag');
  cpSync(join(FIXTURE, CAPTURES, 'pages'), join(moved, 'captures'), { recursive: true });
  ok(run(moved, '--captures', 'captures'), 2);
  ok(run(moved));
  assert.equal(doc(moved, 'manifest.json').handover, null, 'no capture under the default dir: no mapping needed');
});

check('round trip: the export as the skill runs it (block-origin.mjs --verify, then this script) is fresh to done-check.mjs; a block file changed after it is export_stale naming that file; the three commands make it fresh again', () => {
  const dir = withCaptures('round-trip');
  editJSON(join(dir, 'stardust', 'rollout', 'rollout.json'), (c) => { c.exports = ['migration-workspace']; });
  ok(node(dir, 'block-origin.mjs', '--verify'));
  ok(run(dir));
  const exportGaps = () => { const r = node(dir, 'done-check.mjs', '--offline', '--json'); return JSON.parse(r.stdout).gaps.filter((g) => g.startsWith('export_stale')); };
  assert.deepEqual(exportGaps(), []);
  editText(join(dir, 'blocks', 'hero', 'hero.css'), '}', '}\n.hero { margin: 1px; }');
  assert.deepEqual(exportGaps(), ['export_stale:manifest hashes differ from the tree: blocks/hero/hero.css — rehash-safe: workspace-manifest.mjs --rehash-only']);
  rebuild(dir);
  ok(node(dir, 'block-origin.mjs', '--verify'));
  ok(run(dir));
  assert.deepEqual(exportGaps(), []);
});

check('--check / --rehash-only: fresh; a block CSS drift is rehash-safe and --rehash-only clears it (idempotent); coverage regenerated stays rehash-safe (adopter blocked, mapping generatedAt reconciled); a content drift is rebuild and --rehash-only refuses', () => {
  const build = (label) => {
    const dir = withCaptures(label);
    editJSON(join(dir, 'stardust', 'rollout', 'rollout.json'), (c) => { c.exports = ['migration-workspace']; });
    ok(node(dir, 'block-origin.mjs', '--verify'));
    ok(run(dir));
    return dir;
  };
  const exportGaps = (dir) => JSON.parse(node(dir, 'done-check.mjs', '--offline', '--json').stdout).gaps.filter((g) => g.startsWith('export_stale'));

  // fresh
  const fresh = build('check-fresh');
  const c0 = run(fresh, '--check', '--json');
  ok(c0, 0);
  assert.equal(jsonOut(c0).status, 'fresh');
  assert.deepEqual(jsonOut(c0).drifted, []);

  // a block CSS drift → rehash-safe (exit 5), adopter not blocked; --rehash-only clears it, idempotent
  const css = build('check-css');
  editText(join(css, 'blocks', 'hero', 'hero.css'), '}', '}\n.hero { margin: 1px; }');
  const c1 = run(css, '--check', '--json');
  ok(c1, 5);
  assert.equal(jsonOut(c1).status, 'rehash-safe');
  assert.deepEqual(jsonOut(c1).drifted, ['blocks/hero/hero.css']);
  assert.equal(jsonOut(c1).adopterBlocked, false);
  assert.deepEqual(exportGaps(css), ['export_stale:manifest hashes differ from the tree: blocks/hero/hero.css — rehash-safe: workspace-manifest.mjs --rehash-only']);
  const r1 = run(css, '--rehash-only', '--json');
  ok(r1, 0);
  assert.equal(jsonOut(r1).status, 'rehashed');
  assert.deepEqual(exportGaps(css), []);
  ok(run(css, '--check'), 0);
  const cssBytes = text(css, 'manifest.json');
  const r1b = run(css, '--rehash-only', '--json');
  ok(r1b, 0);
  assert.equal(jsonOut(r1b).status, 'unchanged', 'a second re-hash is byte-identical');
  assert.equal(text(css, 'manifest.json'), cssBytes);

  // coverage regenerated after the manifest (inventory + blocks re-run on the CSS edit): still rehash-safe, the
  // adopter is blocked (pages.json sha drifted), and --rehash-only reconciles the mapping generatedAt so done-check clears
  const cov = build('check-cov');
  editText(join(cov, 'blocks', 'hero', 'hero.css'), '}', '}\n.hero { padding: 2px; }');
  rebuild(cov);
  const c2 = run(cov, '--check', '--json');
  ok(c2, 5);
  assert.equal(jsonOut(c2).status, 'rehash-safe');
  assert.equal(jsonOut(c2).adopterBlocked, true);
  assert.ok(jsonOut(c2).drifted.includes('stardust/rollout/coverage/pages.json'), JSON.stringify(jsonOut(c2).drifted));
  const pagesAt = JSON.parse(readFileSync(join(cov, 'stardust', 'rollout', 'coverage', 'pages.json'), 'utf8')).generatedAt;
  assert.notEqual(doc(cov, 'mapping.json').generatedAt, pagesAt, 'the regenerated coverage moved the generatedAt the mapping has not caught up to');
  ok(run(cov, '--rehash-only'), 0);
  assert.equal(doc(cov, 'mapping.json').generatedAt, pagesAt, 'the mapping generatedAt is reconciled to pages.json');
  assert.deepEqual(exportGaps(cov), []);
  ok(node(cov, 'block-origin.mjs', '--verify'));
  assert.equal(doc(cov, 'mapping.json').generatedAt, pagesAt, 'block-origin --verify agrees: the reconciled mapping is what it would write');

  // a content drift → rebuild (exit 4); --rehash-only refuses and writes nothing
  const content = build('check-content');
  const manifestBytes = text(content, 'manifest.json');
  editText(join(content, 'content', 'index.html'), '</main>', '<p>new</p></main>');
  const c3 = run(content, '--check', '--json');
  ok(c3, 4);
  assert.equal(jsonOut(c3).status, 'rebuild');
  assert.ok(jsonOut(c3).drifted.includes('content'), JSON.stringify(jsonOut(c3).drifted));
  const r3 = run(content, '--rehash-only');
  ok(r3, 4);
  assert.match(r3.stderr, /rebuild needed/);
  assert.equal(text(content, 'manifest.json'), manifestBytes, 'a refused re-hash writes nothing');

  // --check and --rehash-only cannot be combined, nor with --draft-judgement
  ok(run(fresh, '--check', '--rehash-only'), 2);
  ok(run(fresh, '--rehash-only', '--draft-judgement'), 2);
});

check('mapping required: --allow-no-mapping keeps the manifest written (handover null, exit 0) with captures present; the captures are hashed under inputs so a changed capture is export_stale', () => {
  const dir = withCaptures('allow-no-mapping');
  const r = run(dir, '--allow-no-mapping');
  ok(r);
  assert.equal(r.stderr.includes('missing:'), false, r.stderr);
  assert.equal(doc(dir, 'manifest.json').handover, null);
  const inputs = doc(dir, 'manifest.json').inputs;
  const capKeys = Object.keys(inputs).filter((k) => k.startsWith('stardust/current/pages/') && k.endsWith('.html'));
  assert.ok(capKeys.length >= 1, `the captures block-origin reads are inputs: ${Object.keys(inputs).join(', ')}`);
  for (const k of capKeys) assert.equal(inputs[k], sha(readFileSync(join(dir, k))), k);
  const plain = copy('allow-no-mapping-plain');
  ok(run(plain));
  assert.equal(Object.keys(doc(plain, 'manifest.json').inputs).some((k) => k.startsWith('stardust/current/pages/')), false, 'a project without captures hashes none');
});

check('idempotent: a second run is "unchanged" and rewrites nothing, also after inventory and blocks re-run and from another cwd; deleting and re-running gives the same bytes; --dry-run writes nothing', () => {
  const dir = copy('idempotent');
  ok(run(dir));
  const bytes = text(dir, 'manifest.json');
  const mtime = statSync(join(W(dir), 'manifest.json')).mtimeMs;
  const second = run(dir, '--json');
  ok(second);
  assert.equal(jsonOut(second).status, 'unchanged');
  assert.equal(jsonOut(second).hashes['manifest.json'], sha(bytes));
  rebuild(dir);
  const elsewhere = node(ROOT, 'workspace-manifest.mjs', '--out', OUT(dir), '--project', dir, '--json');
  ok(elsewhere);
  assert.equal(jsonOut(elsewhere).status, 'unchanged', 'unchanged coverage keeps its bytes; paths are project-relative');
  assert.equal(statSync(join(W(dir), 'manifest.json')).mtimeMs, mtime, 'an unchanged run rewrites nothing');
  assert.deepEqual(readdirSync(W(dir)), ['manifest.json'], 'no temp file left behind');
  rmSync(join(W(dir), 'manifest.json'));
  ok(run(dir));
  assert.equal(text(dir, 'manifest.json'), bytes, 'not reproduced byte for byte');
  const fresh = copy('dry-run');
  const dry = run(fresh, '--dry-run');
  ok(dry);
  assert.match(dry.stdout, /would write/);
  assert.equal(jsonOut(run(fresh, '--dry-run', '--json')).status, 'dry-run');
  assert.equal(existsSync(W(fresh)), false, '--dry-run created the workspace dir');
});

check('atomic: a failure before the rename leaves the previous file and no temp file (nor a dir the write made); the CLI exits 1 and leaves the workspace as it was', () => {
  const { writeAtomic } = wm;
  const dir = mkdtempSync(join(ROOT, 'atomic-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, '{"previous":true}\n');
  assert.throws(() => writeAtomic(path, '{"next":true}\n', { beforeRename: () => { throw new Error('injected failure'); } }), /injected failure/);
  assert.equal(readFileSync(path, 'utf8'), '{"previous":true}\n');
  assert.deepEqual(readdirSync(dir), ['manifest.json']);
  assert.throws(() => writeAtomic(join(dir, 'new', 'deeper', 'manifest.json'), '{}\n', { beforeRename: () => { throw new Error('injected failure'); } }), /injected failure/);
  assert.deepEqual(readdirSync(dir), ['manifest.json'], 'the directories the failed write made are gone');
  writeAtomic(path, '{"next":true}\n');
  assert.equal(readFileSync(path, 'utf8'), '{"next":true}\n');
  assert.deepEqual(readdirSync(dir), ['manifest.json']);
  // End to end: the rename cannot land (manifest.json is a directory).
  const site = copy('atomic-cli');
  mkdirSync(join(W(site), 'manifest.json', 'blocker'), { recursive: true });
  const r = run(site);
  ok(r, 1);
  assert.match(r.stderr, /write failed/);
  assert.deepEqual(readdirSync(W(site)), ['manifest.json'], 'no temp file left behind');
  assert.deepEqual(readdirSync(join(W(site), 'manifest.json')), ['blocker']);
});

check('exit 1: no coverage (none, one missing, one unparseable), coverage without formatVersion or with another one, stale coverage (a content file edited, removed); nothing written', () => {
  const empty = mkdtempSync(join(ROOT, 'empty-'));
  const none = node(empty, 'workspace-manifest.mjs');
  ok(none, 1);
  assert.match(none.stderr, /run inventory\.mjs and blocks\.mjs/);
  assert.deepEqual(readdirSync(empty), []);
  const cases = {
    missing: (dir) => rmSync(join(dir, COV[0])),
    unparseable: (dir) => writeFileSync(join(dir, COV[2]), '{ not json'),
    'no-format': (dir) => editJSON(join(dir, COV[1]), (d) => { delete d.formatVersion; }),
    'other-format': (dir) => editJSON(join(dir, COV[0]), (d) => { d.formatVersion = '9.0.0'; }),
  };
  for (const [label, breakIt] of Object.entries(cases)) {
    const dir = copy(label);
    breakIt(dir);
    const r = run(dir);
    ok(r, 1);
    assert.match(r.stderr, /formatVersion|missing|unreadable/, `${label}: ${r.stderr}`);
    assert.equal(existsSync(W(dir)), false, `${label}: wrote something`);
  }
  const stale = copy('stale');
  editText(join(stale, 'content', 'about-us.html'), '<div class="columns wide">', '<div class="columns">');
  const r = run(stale);
  ok(r, 1);
  assert.match(r.stderr, /coverage is stale: 1 page\(s\).*about-us.*re-run inventory\.mjs/);
  assert.equal(existsSync(W(stale)), false);
  rebuild(stale);
  ok(run(stale));
  const gone = copy('gone');
  rmSync(join(gone, 'content', 'de', 'ueber-uns.html'));
  const g = run(gone);
  ok(g, 1);
  assert.match(g.stderr, /coverage is stale: 1 page\(s\).*de-ueber-uns/, 'a page with delivered structure and no content file');
});

check('freshness: --draft-judgement works on stale coverage; the manifest run refuses (exit 1, nothing written, --force too) a judgement, block code or conversion log changed since blocks.mjs, a recorded file gone, a judgement blocks.mjs did not read, a blocks.json without _provenance.inputs', () => {
  const dir = copy('fresh');
  const blocksJson = join(dir, COV[0]);
  const recorded = JSON.parse(readFileSync(blocksJson, 'utf8'))._provenance.inputs;
  assert.ok(recorded && typeof recorded === 'object', 'blocks.json records _provenance.inputs');
  assert.ok(Object.keys(recorded).some((k) => /(^|\/)blocks\/hero\/hero\.js$/.test(k)) && Object.keys(recorded).some((k) => /eds-conversion-log\.md$/.test(k)), JSON.stringify(Object.keys(recorded)));
  ok(run(dir));
  const refused = (pattern, ...args) => {
    const before = snapshot(W(dir));
    const r = run(dir, ...args);
    ok(r, 1);
    assert.match(r.stderr, pattern);
    assert.match(r.stderr, /re-run blocks\.mjs/);
    assert.deepEqual(snapshot(W(dir)), before, 'a refused run wrote something');
    assert.deepEqual(readdirSync(W(dir)).filter((f) => f.endsWith('.tmp')), []);
  };
  // A judgement drafted after blocks.mjs ran is one it did not read; the draft itself needs no fresh coverage.
  editText(join(dir, 'content', 'about-us.html'), '<div class="columns wide">', '<div class="columns">');
  const draft = run(dir, '--draft-judgement', '--json');
  ok(draft);
  assert.equal(jsonOut(draft).status, 'drafted', 'the draft runs on stale content');
  ok(run(dir), 1);
  rebuild(dir);
  ok(run(dir));
  const judged = text(dir, 'manifest.json');
  editJSON(join(W(dir), 'judgement.json'), (j) => { j.blocks.hero.purpose = 'Opens the page.'; });
  refused(/judgement\.json \(changed\)/);
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  editText(join(dir, 'blocks', 'hero', 'hero.js'), '/**', '/** Changed. ');
  writeFileSync(join(W(dir), 'handover.json'), '{"at":"2026-10-01T00:00:00.000Z","by":"a migration tool"}\n');
  const forced = run(dir, '--force');
  ok(forced, 1);
  assert.match(forced.stderr, /hero\/hero\.js \(changed\).*re-run blocks\.mjs/, '--force does not bypass freshness');
  rmSync(join(W(dir), 'handover.json'));
  refused(/hero\/hero\.js \(changed\)/);
  editText(join(dir, 'stardust', 'eds-conversion-log.md'), 'row 1 the picture', 'row 1 the image');
  refused(/eds-conversion-log\.md \(changed\)/);
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  assert.notEqual(text(dir, 'manifest.json'), judged);
  rmSync(join(dir, 'blocks', 'teaser', 'teaser.css'));
  refused(/teaser\/teaser\.css \(gone\)/);
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  // Drafted after blocks.mjs: not read.
  const late = copy('late-judgement');
  ok(run(late, '--draft-judgement'));
  const r = run(late);
  ok(r, 1);
  assert.match(r.stderr, /stardust\/rollout\/workspace\/judgement\.json \(not read\).*re-run blocks\.mjs/);
  assert.deepEqual(readdirSync(W(late)), ['judgement.json']);
  ok(node(late, 'blocks.mjs'));
  ok(run(late));
  // An older blocks.json records nothing: the draft still runs, the manifest does not.
  const old = copy('old-blocks');
  editJSON(join(old, COV[0]), (d) => { delete d._provenance.inputs; });
  const o = run(old);
  ok(o, 1);
  assert.match(o.stderr, /no _provenance\.inputs.*re-run blocks\.mjs/);
  assert.equal(existsSync(W(old)), false);
  ok(run(old, '--draft-judgement'));
});

check('handover: a handover.json marker → exit 3, the reason on stderr, nothing written; --json reports handed-over; --force with unchanged inputs records the handover without degraded', () => {
  const marker = '{"at":"2026-10-01T00:00:00.000Z","by":"a migration tool"}\n';
  const fresh = copy('marker-fresh');
  mkdirSync(W(fresh), { recursive: true });
  writeFileSync(join(W(fresh), 'handover.json'), marker);
  const r = run(fresh, '--json');
  ok(r, 3);
  assert.match(r.stderr, /handed over/);
  assert.equal(jsonOut(r).status, 'handed-over');
  assert.deepEqual(readdirSync(W(fresh)), ['handover.json']);
  const dir = copy('marker');
  ok(run(dir));
  writeFileSync(join(W(dir), 'handover.json'), marker);
  const before = snapshot(W(dir));
  ok(run(dir), 3);
  ok(run(dir, '--draft-judgement'), 3);
  assert.deepEqual(snapshot(W(dir)), before);
  ok(run(dir, '--force'));
  const mf = doc(dir, 'manifest.json');
  assert.equal(mf.handover && mf.handover.detectedFrom, 'marker');
  assert.equal('degraded' in mf, false, 'inputs unchanged: not degraded');
  assert.equal(text(dir, 'handover.json'), marker, 'the marker is never written by stardust');
});

check('handover: content tracked, then untracked → exit 3; --force (after the client edits content and coverage is rebuilt) records handover + degraded; a second forced run keeps both, byte for byte; a plain run → exit 3', () => {
  const dir = gitCopy('git');
  ok(run(dir));
  assert.equal(doc(dir, 'manifest.json').inputs.content.tracked, true, 'content recorded as tracked');
  git(dir, 'rm', '-r', '-q', '--cached', 'content');
  git(dir, 'commit', '-q', '-m', 'content handed over');
  const before = snapshot(W(dir));
  const r = run(dir);
  ok(r, 3);
  assert.match(r.stderr, /no longer tracked/);
  assert.deepEqual(snapshot(W(dir)), before, 'a refused run writes nothing');
  editText(join(dir, 'content', 'index.html'), '<h1>', '<h1>Hello, ');
  ok(run(dir, '--force'), 1);
  rebuild(dir);
  ok(run(dir, '--force'));
  const first = doc(dir, 'manifest.json');
  assert.equal(first.handover && first.handover.detectedFrom, 'untracked-content');
  assert.ok(!Number.isNaN(Date.parse(first.handover.at)), 'handover.at is a timestamp');
  assert.deepEqual(first.degraded && first.degraded.inputs, ['content']);
  assert.equal(first.inputs.content.tracked, false);
  assert.deepEqual(validate(loadSchema('rollout-workspace-manifest.schema.json'), first), []);
  const bytes = text(dir, 'manifest.json');
  const again = run(dir, '--force', '--json');
  ok(again);
  assert.equal(jsonOut(again).status, 'unchanged', 'the recorded handover and degraded are kept');
  assert.equal(text(dir, 'manifest.json'), bytes);
  editText(join(dir, 'blocks', 'hero', 'hero.css'), '.hero {', '.hero.wide, .hero {');
  rebuild(dir);
  ok(run(dir, '--force'));
  const third = doc(dir, 'manifest.json');
  assert.deepEqual(third.handover, first.handover, 'the first handover stays');
  assert.deepEqual(third.degraded.inputs, ['blocks/hero/hero.css', 'content'], 'degraded accumulates');
  ok(run(dir), 3);
  // A project nested in an outer repository is not its own repository root: tracked is null.
  const outer = mkdtempSync(join(ROOT, 'outer-'));
  git(outer, '-c', 'init.defaultBranch=main', 'init', '-q');
  cpSync(BASE, join(outer, 'site'), { recursive: true });
  git(outer, 'add', '-A');
  git(outer, 'commit', '-q', '-m', 'outer');
  ok(run(join(outer, 'site')));
  assert.equal(doc(join(outer, 'site'), 'manifest.json').inputs.content.tracked, null);
});

check('judgement: --draft-judgement writes only judgement.json, only when absent — empty fields (a known base type pre-filled; colorScheme present but not in toFill), suggestions under defaults, sorted toFill; judged values reach coverage through blocks.mjs and the placeholders shrink', () => {
  const dir = copy('judgement');
  ok(run(dir, '--draft-judgement', '--dry-run'));
  assert.equal(existsSync(W(dir)), false, '--draft-judgement --dry-run wrote something');
  const drafted = run(dir, '--draft-judgement', '--json');
  ok(drafted);
  assert.equal(jsonOut(drafted).status, 'drafted');
  assert.deepEqual(readdirSync(W(dir)), ['judgement.json'], 'the draft writes no manifest');
  const j = doc(dir, 'judgement.json');
  assert.deepEqual(Object.keys(j), ['_provenance', 'templates', 'blocks', 'defaults', 'toFill']);
  assert.equal(j._provenance.writtenBy, 'stardust:rollout/workspace-manifest');
  const open = { purpose: '', reuseGuidance: { suitableFor: [], notSuitableFor: [] }, colorScheme: '' };
  assert.deepEqual(j.templates, { 'about-us': { name: '', description: '' }, home: { name: '', description: '' } });
  assert.deepEqual(j.blocks, { breadcrumb: { baseType: 'breadcrumbs', ...open }, columns: { baseType: 'columns', ...open }, hero: { baseType: 'hero', ...open }, teaser: { baseType: '', ...open } });
  const modules = 'blocks hero-banner, link-list, three-up.';
  const CANDIDATES = ['accordion', 'breadcrumbs', 'cards', 'carousel', 'columns', 'embed', 'form', 'fragment', 'hero', 'modal', 'quote', 'search', 'table', 'tabs', 'video'];
  assert.deepEqual(j.defaults, {
    templates: { 'about-us': { name: 'article', description: `article: 2 page(s); ${modules}` }, home: { name: 'home', description: `home: 1 page(s); ${modules}` } },
    // an unjudged block (teaser) offers the candidate list; unknown is not among the candidates (it is the absence of a judgement)
    blocks: { breadcrumb: { baseType: 'breadcrumbs' }, columns: { baseType: 'columns' }, hero: { baseType: 'hero' }, teaser: { baseType: 'unknown', baseTypeCandidates: CANDIDATES } },
  });
  assert.deepEqual(j.toFill, [
    ...['about-us', 'home'].flatMap((t) => [`templates.${t}.name`, `templates.${t}.description`]),
    ...['breadcrumb', 'columns', 'hero', 'teaser'].flatMap((b) => [`blocks.${b}.purpose`, `blocks.${b}.reuseGuidance`]),
    'blocks.teaser.baseType',
  ].sort(byStr));
  j.templates['about-us'].name = 'story-page';
  j.blocks.teaser.baseType = 'cards';
  j.blocks.teaser.purpose = 'Lists linked cards.';
  const edited = `${JSON.stringify(j, null, 2)}\n`;
  writeFileSync(join(W(dir), 'judgement.json'), edited);
  const again = run(dir, '--draft-judgement', '--json');
  ok(again);
  assert.equal(jsonOut(again).status, 'draft-present');
  assert.equal(text(dir, 'judgement.json'), edited, 'a present judgement.json is left as is');
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  assert.equal(JSON.parse(readFileSync(join(dir, COV[2]), 'utf8')).templates.find((t) => t.id === 'about-us').name, 'story-page');
  assert.deepEqual(doc(dir, 'manifest.json').placeholders, [
    'blocks[].purpose: 3 block(s) without purpose (not judged)',
    'blocks[].reuseGuidance: 4 block(s) without reuse guidance (not judged)',
    'templates[].description: 2 template(s) without a description (not judged)',
    'templates[].name: 1 template(s) without a name (not judged)',
  ], 'one name, one purpose and the unknown base type judged; toFill is informational; colorScheme is never a placeholder');
});

check('judgement: default names are kebab(type || id), made unique in id order with -2, -3; descriptions count pages and list module ids (chrome ids left out) or "none"', () => {
  const { draftJudgement } = wm;
  const coverage = {
    templates: { templates: [
      { id: 'b', type: 'Article Page', pageCount: 2, blocks: ['teaser-row', 'header', 'hero-banner', 'footer'] },
      { id: 'a', type: 'article-page', pages: ['x'], blocks: [] },
      { id: 'c', type: null, pageCount: 0, blocks: [] },
      { id: 'd', type: 'article page', pageCount: 1, blocks: ['nav'] },
    ] },
    blocks: { blocks: [] },
  };
  const j = draftJudgement(coverage, { writtenBy: 'test' });
  assert.deepEqual(Object.fromEntries(Object.entries(j.defaults.templates).map(([id, t]) => [id, t.name])), { a: 'article-page', b: 'article-page-2', c: 'c', d: 'article-page-3' });
  assert.equal(j.defaults.templates.b.description, 'article-page-2: 2 page(s); blocks hero-banner, teaser-row.');
  assert.equal(j.defaults.templates.a.description, 'article-page: 1 page(s); blocks none.');
  assert.equal(j.defaults.templates.d.description, 'article-page-3: 1 page(s); blocks none.');
});

check('pendingBlocks: a module block is pending only with delivered instances and no conversion record (converted, deployed, verified, not-delivered); unused rows, default content and chrome never are; EDS names sorted', () => {
  const { pendingBlocks } = wm;
  const row = (id, status, instances) => ({ id, kind: 'module', delivery: { status, edsBlockName: id }, ...(instances == null ? {} : { variants: [{ id: `v_${id}`, classes: [], pages: 1, instances }] }) });
  const blocksDoc = { blocks: [
    row('zeta', 'pending', 2), row('alpha', 'failed', 1), row('idle', 'pending', 0), row('unused', 'pending', null),
    row('done', 'converted', 3), row('live', 'deployed', 1), row('ok', 'verified', 1), row('skipped', 'not-delivered', 1),
    { id: 'text', kind: 'module', delivery: { status: 'pending', edsBlockName: 'default-content' }, variants: [{ instances: 4 }] },
    { id: 'header', kind: 'chrome', delivery: { status: 'pending' }, variants: [{ instances: 1 }] },
  ] };
  assert.deepEqual(pendingBlocks(blocksDoc), ['alpha', 'zeta']);
  for (const empty of [null, {}, { blocks: null }]) assert.deepEqual(pendingBlocks(empty), []);
});

check('placeholders: blocks delivered without a conversion record are one line naming update-coverage.mjs --block', () => {
  const dir = copy('pending-blocks');
  ok(node(dir, 'update-coverage.mjs', '--block', 'hero-banner', '--status', 'pending'));
  ok(run(dir));
  assert.deepEqual(doc(dir, 'manifest.json').placeholders, [...BASE_PLACEHOLDERS, 'blocks[].delivery: 1 block(s) delivered without a conversion record (update-coverage.mjs --block)'].sort(byStr));
});

check('placeholders: the "(not judged)" summary lines from coverage, sorted; pages with delivered: null counted (a state roster page without a content file)', () => {
  const dir = copy('placeholders');
  ok(run(dir));
  assert.deepEqual(doc(dir, 'manifest.json').placeholders, BASE_PLACEHOLDERS);
  const roster = copy('roster');
  rmSync(join(roster, 'stardust', 'migrated', 'de'), { recursive: true }); // --state is archetypes-only: no sibling in the tree
  rebuild(roster, '--state', 'stardust/state.json');
  ok(run(roster));
  const lines = doc(roster, 'manifest.json').placeholders;
  assert.ok(lines.includes('pages[].delivered: 1 page(s) without a content file (null)'), lines.join('\n'));
  assert.deepEqual(lines, [...lines].sort(byStr));
});

check('usage: exit 2 on an unknown flag, a positional argument or a value flag without its value; --help/-h in an empty dir prints the Usage line and writes nothing', () => {
  const empty = mkdtempSync(join(ROOT, 'usage-'));
  for (const args of [['--bogus'], ['stray'], ['--out'], ['--out', '--json'], ['--content']]) {
    const r = node(empty, 'workspace-manifest.mjs', ...args);
    ok(r, 2);
    assert.match(r.stderr, /usage: workspace-manifest\.mjs/, args.join(' '));
  }
  for (const flag of ['--help', '-h']) {
    const h = node(empty, 'workspace-manifest.mjs', flag, '--bogus');
    ok(h);
    assert.ok(h.stdout.includes('Usage: node skills/rollout/scripts/workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--captures <dir>] [--allow-no-mapping] [--check] [--rehash-only] [--draft-judgement] [--force] [--dry-run] [--json]'), h.stdout);
  }
  assert.deepEqual(readdirSync(empty), [], '--help or a usage error wrote something');
});

check('identity: the manifest and the judgement draft carry no DA org/site, project host, DA path or repository, nor the machine path; draft defaults are scrubbed', () => {
  const dir = copy('identity');
  editJSON(join(dir, 'stardust', 'migrated', 'about-us._meta.json'), (m) => { m.type = 'fixture-site landing'; });
  rebuild(dir);
  ok(run(dir, '--draft-judgement'));
  ok(node(dir, 'blocks.mjs'));
  ok(run(dir));
  for (const f of ['manifest.json', 'judgement.json']) {
    assert.deepEqual(leaks(text(dir, f)), [], `${f} carries identity`);
    assert.equal(text(dir, f).includes(dir), false, `${f} carries the absolute project path`);
  }
  assert.equal(doc(dir, 'judgement.json').defaults.templates['about-us'].name, '<site>-landing');
});

check('lib identity: patterns become <repo-url>, <host>, <da-path>; tokens from rollout.json and state.json become <site>; findIdentity names JSON paths, never a token; patterns are not global', () => {
  const { identityTokens, scrubIdentity, findIdentity, IDENTITY_PATTERNS } = lib;
  const fixtureJson = (rel) => JSON.parse(readFileSync(join(FIXTURE, rel), 'utf8'));
  const tokens = identityTokens({ rollout: fixtureJson('stardust/rollout/rollout.json'), state: fixtureJson('stardust/state.json') });
  for (const t of ['fixture-org', 'fixture-site', 'fixture-org/fixture-site', 'main--fixture-site--fixture-org', 'main--fixture-site--fixture-org.aem.page']) {
    assert.ok(tokens.includes(t), `token ${t} in ${JSON.stringify(tokens)}`);
  }
  assert.equal(tokens.some((t) => 'www.example.com'.includes(t.toLowerCase())), false, 'nothing the source host contains');
  assert.deepEqual(tokens, [...tokens].sort((a, b) => b.length - a.length || byStr(a, b)), 'longest first');
  const scrubbed = scrubIdentity('Code at https://github.com/fixture-owner/fixture-repo/blob/main/x.js and preview https://main--other-site--other-org.aem.page/x and media https://content.da.live/other-org/other-site/media/ and docs for Fixture-Org/fixture-site.', tokens);
  assert.equal(scrubbed, 'Code at <repo-url> and preview https://<host>/x and media https://<da-path> and docs for <site>.');
  assert.equal(scrubIdentity('', tokens), '');
  assert.equal(scrubIdentity(null, tokens), null);
  const hits = findIdentity({ title: 'about fixture-site', list: ['ok', 'FIXTURE-ORG'], 'fixture-org': 'key' }, tokens);
  assert.deepEqual(hits, ['$.title', '$.list[1]', '$.*']);
  assert.equal(hits.join(' ').includes('fixture'), false);
  assert.ok(Array.isArray(IDENTITY_PATTERNS) && IDENTITY_PATTERNS.length >= 3);
  for (const re of IDENTITY_PATTERNS) assert.equal(re.global || re.sticky, false, `${re} keeps state between .test() calls`);
});

check('lib identity: scrubIdentity and findIdentity finish in < 200 ms each on 10,000 chars of "-" and of "a--"', () => {
  const { scrubIdentity, findIdentity, identityTokens } = lib;
  const fixtureJson = (rel) => JSON.parse(readFileSync(join(FIXTURE, rel), 'utf8'));
  const tokens = identityTokens({ rollout: fixtureJson('stardust/rollout/rollout.json'), state: fixtureJson('stardust/state.json') });
  for (const [label, s] of [['-', '-'.repeat(10000)], ['a--', 'a--'.repeat(3334).slice(0, 10000)]]) {
    for (const [fn, call] of [['scrubIdentity', () => scrubIdentity(s, tokens)], ['findIdentity', () => findIdentity({ title: s, items: [s] }, tokens)]]) {
      const t0 = performance.now();
      call();
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `${fn} on 10,000 × "${label}" took ${ms.toFixed(0)} ms`);
    }
  }
});

check('moved project: coverage built with absolute --out/--blocks from another cwd, then the project dir moved (renamed) — workspace-manifest.mjs --project <new path> exits 0, not stale', () => {
  const dir = join(mkdtempSync(join(ROOT, 'abs-')), 'site');
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, CAPTURES), { recursive: true });
  const elsewhere = mkdtempSync(join(ROOT, 'cwd-'));
  const blocksArgs = ['--out', OUT(dir), '--blocks', join(dir, 'blocks')];
  for (const r of [
    node(elsewhere, 'inventory.mjs', '--migrated', join(dir, 'stardust', 'migrated'), '--out', OUT(dir), '--content', join(dir, 'content')),
    node(elsewhere, 'blocks.mjs', ...blocksArgs),
    ...CONVERSIONS.map(([id, name]) => node(elsewhere, 'update-coverage.mjs', '--block', id, '--status', 'converted', '--eds-name', name, '--out', OUT(dir))),
    node(elsewhere, 'blocks.mjs', ...blocksArgs),
  ]) ok(r);
  const moved = join(mkdtempSync(join(ROOT, 'moved-')), 'site');
  renameSync(dir, moved);
  const r = run(moved, '--project', moved);
  ok(r);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /stale/);
  assert.ok(existsSync(join(W(moved), 'manifest.json')), 'manifest.json written in the moved project');
});

rmSync(ROOT, { recursive: true, force: true });
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
