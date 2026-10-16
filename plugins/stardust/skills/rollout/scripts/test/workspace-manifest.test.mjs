#!/usr/bin/env node
// skills/rollout/scripts/test/workspace-manifest.test.mjs — the workspace-manifest.mjs contract
// (reference/coverage-contract.md): on the delivered-site fixture, coverage is built the way a run
// builds it (inventory.mjs → blocks.mjs → conversions recorded with update-coverage.mjs → blocks.mjs),
// then the manifest: it validates against its schema; outputs hash the three coverage files and
// inputs the content, the block code and the judgement; byte-identical re-runs and a --dry-run that
// writes nothing; a temp-file write that leaves nothing behind on failure; exit 1 without coverage,
// without formatVersion or on stale coverage; handover (marker, untracked content, --force +
// degraded, a second forced run keeping the first handover); the judgement draft; placeholders;
// exit 2 on usage errors; --help writes nothing; no identity in the manifest or the draft; a project
// moved after coverage was built with absolute flags is not stale. Also the
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
const setup = buildCoverage(BASE);
const copy = (label) => { const dir = mkdtempSync(join(ROOT, `${label}-`)); cpSync(BASE, dir, { recursive: true }); return dir; };
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
  'blocks[].purpose: 3 block(s) without purpose (not judged)',
  'blocks[].reuseGuidance: 3 block(s) without reuse guidance (not judged)',
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
  assert.deepEqual(Object.keys(mf), ['_provenance', 'formatVersion', 'inputs', 'outputs', 'placeholders', 'handover']);
  assert.deepEqual(validate(schema, mf), []);
  const broken = JSON.parse(JSON.stringify(mf));
  broken.outputs[COV[0]] = 'sha256:xyz';
  delete broken.handover;
  const errors = validate(schema, broken);
  assert.ok(errors.some((e) => /missing required handover/.test(e)) && errors.some((e) => /does not match/.test(e)), errors.join('\n'));
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
  assert.deepEqual(j.blocks, { columns: { baseType: 'columns', ...open }, hero: { baseType: 'hero', ...open }, teaser: { baseType: '', ...open } });
  const modules = 'blocks hero-banner, link-list, three-up.';
  assert.deepEqual(j.defaults, {
    templates: { 'about-us': { name: 'article', description: `article: 2 page(s); ${modules}` }, home: { name: 'home', description: `home: 1 page(s); ${modules}` } },
    blocks: { columns: { baseType: 'columns' }, hero: { baseType: 'hero' }, teaser: { baseType: 'unknown' } },
  });
  assert.deepEqual(j.toFill, [
    ...['about-us', 'home'].flatMap((t) => [`templates.${t}.name`, `templates.${t}.description`]),
    ...['columns', 'hero', 'teaser'].flatMap((b) => [`blocks.${b}.purpose`, `blocks.${b}.reuseGuidance`]),
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
    'blocks[].purpose: 2 block(s) without purpose (not judged)',
    'blocks[].reuseGuidance: 3 block(s) without reuse guidance (not judged)',
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

check('placeholders: the "(not judged)" summary lines from coverage, sorted; pages with delivered: null counted (a state roster page without a content file)', () => {
  const dir = copy('placeholders');
  ok(run(dir));
  assert.deepEqual(doc(dir, 'manifest.json').placeholders, BASE_PLACEHOLDERS);
  const roster = copy('roster');
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
    assert.ok(h.stdout.includes('Usage: node skills/rollout/scripts/workspace-manifest.mjs [--out <rolloutDir>] [--project <eds-root>] [--content <dir>] [--blocks <dir>] [--draft-judgement] [--force] [--dry-run] [--json]'), h.stdout);
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
