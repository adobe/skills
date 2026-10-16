#!/usr/bin/env node
// Fixture test: encode.mjs's provenance and idempotency (encode/provenance.mjs) on a copy of fixtures/encode plus a
// state.json — the stage B provenance cases (determinism is encode.test.mjs's):
//
//   provenance    the sidecar's `encode` and `audit.encode` keys (a migrate-shaped sidecar is created when the page has
//                 none), state.json.migrate.generators[<template>], stardust/import/<template>/manifest.json — and
//                 deploy's stage-content.mjs stages from exactly these
//   zero writes   a second run, --force and a whitespace-only map edit rewrite no document, sidecar, manifest or
//                 state.json; --dry-run writes nothing
//   precision     a map edit scoped to one page by its id rewrites only that page's document; encodedAt moves only with
//                 the output bytes; generators follow the map, every other state.json byte stays; a site input (the
//                 media ledger) is in the key: its edit re-encodes, rewriting only the page whose bytes change
//   co-existence  migrate.mjs gate between two encodes: not refused, gatesPassed kept; sourceCurrentSha never touched
//   stale output  a page that stops after a clean encode keeps its document and manifest entry, its sidecar records the
//                 stop, staging skips it (exit 0, content/ untouched) while a stale, hand-edited document is refused
//                 (exit 2); once it encodes clean again the sidecar says so
//   guard         a hand-edited document → hand-edit (exit 2, nothing written, the message names the path and the fix);
//                 --force still refuses; --overwrite-hand-edit restores the clean bytes; the same edit as a patch passes;
//                 a document the manifest does not list is refused when it differs, adopted when byte-equal; a
//                 patch file holding JSON null is malformed (error), never "no patches"
//   modules       a clean encode keeps migrate's modules[] true: the sorted unique block names (created sidecars
//                 included); the same blocks write nothing, a block the map adds shows up, a stop leaves the list;
//                 the archetype's non-empty list is the model's and stays (R40) — an empty one is filled
//   encodedPageOf the shared R30 rule: a sibling with an encode is encoded (old clone or not), the archetype only
//                 without a migrated HTML; a render's encode: null, a path outside stardust/encoded/ or with .. → null
//   currentEncode the shared reader's verdicts: current (by URL, or from the sidecar alone), stopped with a stale
//                 document, stale (a hand edit under a clean status), missing (no document; a render's encode: null)
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-provenance.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../encode.mjs';
import { currentEncode, encodedPageOf, saveSidecar, sidecarWith } from '../encode/provenance.mjs';

const HERE = import.meta.dirname;
const MIGRATE = join(HERE, '..', 'migrate.mjs');
const STAGE = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'stage-content.mjs');
const A = 'trips-river-walk'; const S1 = 'trips-forest-loop';
const T = mkdtempSync(join(tmpdir(), 'encode-provenance-'));
cpSync(join(HERE, 'fixtures', 'encode'), T, { recursive: true });
const P = (rel) => join(T, rel);
const read = (rel) => readFileSync(P(rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const write = (rel, data) => { mkdirSync(dirname(P(rel)), { recursive: true }); writeFileSync(P(rel), data); };
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const sha256 = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const SHA = /^sha256:[0-9a-f]{64}$/;
const run = async (...args) => { const out = []; const err = []; const code = await main(['--root', T, ...args], { out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join('\n'), err: err.join('\n'), last: out[out.length - 1], pages: args.includes('--json') ? JSON.parse(out[0]).pages : null }; };
const cli = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: T, encoding: 'utf8' });

const DOC = { [A]: 'stardust/encoded/trips/river-walk.html', [S1]: 'stardust/encoded/trips/forest-loop.html' };
const SIDE = { [A]: 'stardust/migrated/trips/river-walk._meta.json', [S1]: 'stardust/migrated/trips/forest-loop._meta.json' };
const MANIFEST = `stardust/import/${A}/manifest.json`; const STATE = 'stardust/state.json'; const VOCAB = `stardust/import/${A}/vocabulary.json`;
const CAPTURE = (slug) => `stardust/current/pages/${slug}.html`;
const PATCH = `stardust/patches/${S1}.json`;
const verdict = () => currentEncode({ root: T, url: 'https://www.example.com/trips/forest-loop.html', docPath: DOC[S1], archetype: A });
// a write is a new inode (tmp + rename) or a new mtime
const stamp = () => Object.fromEntries([...Object.values(DOC), ...Object.values(SIDE), MANIFEST, STATE].map((f) => { const s = statSync(P(f)); return [f, `${s.ino}:${s.mtimeMs}`]; }));

const state0 = {
  site: { originUrl: 'https://www.example.com' }, flow: 'replica', flowChosenAt: '2026-10-01T00:00:00Z', flowSource: 'test',
  pages: [{ slug: A, url: 'https://www.example.com/trips/river-walk.html', title: 'River Walk', status: 'migrated', type: 'trip' }, { slug: S1, url: 'https://www.example.com/trips/forest-loop.html', title: 'Forest Loop', status: 'directed', type: 'trip' }],
  migrate: { sitewide: { canonCss: 'stardust/canon/canon.css', note: 'caf\u00e9 ½' }, pageMap: [{ sourceUrl: '/trips/river-walk.html', outputPath: 'trips/river-walk.html', slug: A, outputPathDefault: null }] },
};
write(STATE, pretty(state0));
const withGenerators = (g) => pretty({ ...state0, migrate: { ...state0.migrate, generators: { [A]: g } } });

try {
  // --- first run: documents, sidecars, manifest, generators ----------------------------------------------------------
  let r = await run('--template', A, '--json');
  assert.equal(r.code, 0, `${r.err}\n${r.out}`); assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 0');
  const docA = read(DOC[A]); const docS = read(DOC[S1]);
  assert.equal(read(MANIFEST), `{\n  "${DOC[S1]}": "${sha256(docS)}",\n  "${DOC[A]}": "${sha256(docA)}"\n}\n`, 'manifest: document path → sha256, sorted, trailing newline, nothing else');
  const sa = json(SIDE[A]); const ss = json(SIDE[S1]);
  assert.deepEqual([sa.slug, sa.type, sa.renderBranch, sa.fidelityTier, sa.template, sa.archetypeSource], [A, 'trip', 'A', 'archetype', null, null], 'a created archetype sidecar is migrate-shaped');
  assert.deepEqual([ss.slug, ss.type, ss.renderBranch, ss.fidelityTier, ss.template, ss.archetypeSource], [S1, 'trip', "A'", 'sibling', A, A], 'a created sibling sidecar: branch A\', tier sibling, the archetype as template');
  assert.deepEqual([ss.outputPath, ss.sidecar, ss.sourceCurrentSha], ['trips/forest-loop.html', 'trips/forest-loop._meta.json', null], 'migrate\'s place for it; sourceCurrentSha is never the encoder\'s');
  assert.deepEqual(ss.gatesPassed, []); assert.deepEqual(Object.keys(ss).slice(0, 3), ['slug', 'type', 'renderBranch']);
  assert.deepEqual([sa.modules, ss.modules], [['facts', 'hero', 'links', 'tabs', 'tags', 'teaser'], ['facts', 'hero', 'links', 'tabs', 'tags', 'teaser']], 'modules[]: the blocks each page emitted (R36)');
  const enc = ss.encode;
  assert.deepEqual(Object.keys(enc), ['encoder', 'map', 'inputs', 'output', 'encodedAt']);
  assert.deepEqual([enc.encoder.script, enc.encoder.version], ['stardust/scripts/migrate/encode.mjs', '1']); assert.match(enc.encoder.sha, SHA);
  assert.equal(enc.map.template, A); assert.match(enc.map.vocabularySha, SHA); assert.match(enc.map.transformSha, SHA);
  assert.equal(enc.inputs.captureSha, sha256(read(CAPTURE(S1))), 'captureSha: sha256 of the capture HTML');
  assert.match(enc.inputs.pageJsonSha, SHA); assert.match(enc.inputs.siteSha, SHA); assert.equal(enc.inputs.patchesSha, null);
  assert.equal(enc.inputs.archetypeCaptureSha, sa.encode.inputs.captureSha, 'a sibling\'s variance reads the archetype\'s capture: it is an input');
  assert.equal(sa.encode.inputs.archetypeCaptureSha, null);
  assert.deepEqual(enc.output, { path: DOC[S1], sha: sha256(docS) }); assert.match(enc.encodedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual([sa.encode.encoder, sa.encode.map], [enc.encoder, enc.map], 'one encoder and one map per run');
  assert.equal(ss.audit.encode.status, 'clean'); assert.deepEqual(ss.audit.encode.patchesApplied, []);
  for (const k of ['unmapped', 'flattened', 'variance', 'incomplete', 'dropped', 'hidden', 'mediaUnresolved', 'linksUnresolved']) assert.ok(Array.isArray(ss.audit.encode[k]), `audit.encode.${k}[]`);
  const gen = { script: enc.encoder.script, sha: enc.encoder.sha, version: '1', vocabularySha: enc.map.vocabularySha, transformSha: enc.map.transformSha };
  assert.equal(read(STATE), withGenerators(gen), 'generators[<template>] merged in; every other state.json byte kept');
  assert.deepEqual(r.pages.map((p) => [p.slug, p.write]), [[A, 'encoded'], [S1, 'encoded']]);
  assert.deepEqual(verdict(), { ok: true, kind: 'current', why: `${DOC[S1]} is the current clean encode`, docPath: DOC[S1], sha: sha256(docS), sidecarPath: SIDE[S1], manifestPath: MANIFEST });
  assert.equal(currentEncode({ root: T, sidecarPath: SIDE[S1] }).kind, 'current', 'from the sidecar alone: document and template come from encode');
  write('stardust/migrated/elsewhere._meta.json', pretty({ slug: 'elsewhere', renderBranch: "A'", encode: null, audit: null }));
  assert.deepEqual([currentEncode({ root: T, sidecarPath: 'stardust/migrated/elsewhere._meta.json' }).kind, currentEncode({ root: T, sidecarPath: 'stardust/migrated/elsewhere._meta.json' }).ok], ['missing', false], 'a rendered sidecar (encode: null) is no encoded page');
  assert.deepEqual(encodedPageOf(ss), { docPath: DOC[S1], rel: 'trips/forest-loop.html', archetype: A, isArchetype: false }, 'encodedPageOf: a sibling');
  assert.deepEqual(encodedPageOf(ss, { hasHtml: true }), encodedPageOf(ss), '… still encoded beside an old clone HTML');
  assert.deepEqual(encodedPageOf(sa), { docPath: DOC[A], rel: 'trips/river-walk.html', archetype: A, isArchetype: true }, 'the archetype without a migrated HTML is encoded');
  assert.equal(encodedPageOf(sa, { hasHtml: true }), null, 'the archetype beside its migrated HTML stays a migrated page');
  const bySlug = { ...sa, fidelityTier: null, renderBranch: null };
  assert.equal(encodedPageOf(bySlug, { hasHtml: true }), null, '… also when only its own encode.map.template names it');
  const at = (path) => ({ ...ss, encode: { ...ss.encode, output: { ...ss.encode.output, path } } });
  for (const [v, why] of [[{ ...ss, encode: null, audit: null }, 'a render leaves encode: null'], [at('stardust/migrated/trips/forest-loop.html'), 'outside stardust/encoded/'], [at('stardust/encoded/../content/x.html'), 'a .. segment'], [at('stardust/encoded/trips/forest-loop.json'), 'not a .html document'], [null, 'no sidecar']]) assert.equal(encodedPageOf(v), null, `encodedPageOf → null: ${why}`);
  // modules[]: the block names the page emitted, on a clean encode (R36)
  const page = { slug: S1, role: 'sibling', archetype: A, type: 'trip', url: 'https://www.example.com/trips/forest-loop.html' };
  const clean = (old, blocks) => sidecarWith(old, { ...page, encode: ss.encode, audit: { status: 'clean' }, blocks });
  const made = clean(null, ['teaser featured', 'hero', 'tabs', 'hero', 'links']);
  assert.deepEqual(made.modules, ['hero', 'links', 'tabs', 'teaser'], 'a created sidecar lists its blocks: names only, sorted, unique');
  const noWrite = { writeIfChanged: () => { throw new Error('written'); } };
  assert.equal(saveSidecar(noWrite, T, SIDE[S1], made, clean(made, ['hero', 'links', 'tabs', 'tabs', 'teaser featured'])), false, 'the same blocks again: no write');
  const more = clean({ ...made, modules: ['hero', 'links', 'tabs', 'teaser'] }, ['hero', 'links', 'quote', 'tabs', 'teaser featured']);
  assert.deepEqual(more.modules, ['hero', 'links', 'quote', 'tabs', 'teaser'], 'a block the map adds shows up');
  assert.deepEqual(sidecarWith(more, { ...page, encode: undefined, audit: { status: 'variance' }, blocks: ['hero'] }).modules, more.modules, 'a stop leaves modules as they were');
  assert.deepEqual(sidecarWith(null, { ...page, encode: undefined, audit: { status: 'variance' }, blocks: ['hero'] }).modules, [], '… and records none on a sidecar it creates');
  const arch = { ...page, slug: A, role: 'archetype' };
  const archClean = (old) => sidecarWith(old, { ...arch, encode: sa.encode, audit: { status: 'clean' }, blocks: ['hero', 'quote'] });
  assert.deepEqual(archClean({ ...sa, modules: ['river-hero', 'trail-facts'] }).modules, ['river-hero', 'trail-facts'], 'the archetype\'s recorded modules are the model\'s: kept (R40)');
  assert.deepEqual(archClean({ ...sa, modules: [] }).modules, ['hero', 'quote'], '… an empty archetype list is filled');
  assert.deepEqual(sidecarWith({ ...ss, renderBranch: 'A', modules: ['cards'] }, { ...page, encode: ss.encode, audit: { status: 'clean' }, blocks: ['hero'] }).modules, ['cards'], '… an archetype known by its sidecar (renderBranch A) too');
  let st = cli(STAGE, ['--template', A, '--root', T]);
  assert.equal(st.status, 0, `stage-content stages from these sidecars and this manifest\n${st.stderr}`); assert.equal(read('content/trips/forest-loop.html'), docS);

  // --- zero writes: unchanged inputs, --force, a whitespace-only map edit; --dry-run ----------------------------------
  const s0 = stamp();
  r = await run('--template', A, '--json');
  assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0'); assert.deepEqual(stamp(), s0, 'second run: no document, sidecar, manifest or state.json write');
  assert.ok(r.pages.every((p) => p.skipped && p.status === 'clean' && p.report.patchesApplied), 'the skip predicate holds: nothing encoded, the recorded audit reported');
  r = await run('--template', A, '--force', '--json');
  assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0'); assert.ok(r.pages.every((p) => !p.skipped), '--force bypasses the skip');
  assert.deepEqual(stamp(), s0, '… and the byte gate still writes nothing');
  const vocabRaw = read(VOCAB);
  write(VOCAB, JSON.stringify(JSON.parse(vocabRaw), null, 4));
  r = await run('--template', A);
  assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0'); assert.deepEqual(stamp(), s0, 'a whitespace-only map edit writes nothing');
  // an equal value is never re-serialised: a state.json and a sidecar another tool formatted stay byte for byte
  write(STATE, JSON.stringify(json(STATE), null, 4)); write(SIDE[S1], JSON.stringify(json(SIDE[S1]), null, 4));
  const s0f = stamp();
  r = await run('--template', A, '--force');
  assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0'); assert.deepEqual(stamp(), s0f, 'equal generators and an equal sidecar: no write');

  // --- precision: a map edit scoped to the sibling by its id -------------------------------------------------------
  const OLD = '2000-01-01T00:00:00Z';
  for (const s of [A, S1]) { const m = json(SIDE[s]); m.encode.encodedAt = OLD; write(SIDE[s], pretty(m)); }
  const vocab = JSON.parse(vocabRaw);
  const scoped = { ...vocab, markers: vocab.markers.map((m) => (m.sel === '.mod-tags' ? { ...m, variants: [{ when: '#tags-c7a1f3e905', add: 'compact' }] } : m)) };
  write(VOCAB, JSON.stringify(scoped, null, 2));
  const s1 = stamp();
  r = await run('--template', A, '--dry-run');
  assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0'); assert.deepEqual(stamp(), s1, '--dry-run writes nothing');
  r = await run('--template', A);
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0');
  const s2 = stamp();
  assert.equal(s2[DOC[A]], s1[DOC[A]], 'the archetype\'s document is not rewritten'); assert.notEqual(s2[DOC[S1]], s1[DOC[S1]]);
  assert.match(read(DOC[S1]), /<div class="tags compact">/);
  assert.equal(json(SIDE[A]).encode.encodedAt, OLD, 'encodedAt stays while the output bytes stay'); assert.notEqual(json(SIDE[S1]).encode.encodedAt, OLD);
  const vsha = json(SIDE[S1]).encode.map.vocabularySha;
  assert.notEqual(vsha, enc.map.vocabularySha); assert.equal(json(SIDE[A]).encode.map.vocabularySha, vsha);
  assert.equal(json(MANIFEST)[DOC[S1]], sha256(read(DOC[S1]))); assert.equal(json(MANIFEST)[DOC[A]], sha256(docA));
  assert.equal(read(STATE), withGenerators({ ...gen, vocabularySha: vsha }), 'generators follow the map; nothing else in state.json moves');
  write(VOCAB, vocabRaw);
  r = await run('--template', A);
  assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0'); assert.equal(read(DOC[S1]), docS);
  // a block the map adds shows up in modules[] (the archetype re-delivered with it, so the map round-trips again); the
  // restored map takes it out again
  const GATED = 'content/trips/river-walk.html'; const gatedRaw = read(GATED);
  write(VOCAB, JSON.stringify({ ...vocab, markers: vocab.markers.map((m) => (m.sel === '.mod-image' ? { ...m, emitter: 'block:picture' } : m)) }, null, 2));
  r = await run('--template', A, '--slug', A); assert.equal(r.code, 0, r.out);
  write(GATED, read(DOC[A]));
  r = await run('--template', A);
  assert.equal(r.code, 0, r.out); assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0');
  assert.ok(json(SIDE[S1]).modules.includes('picture'), 'a new block shows up in a sibling\'s modules[]');
  assert.deepEqual(json(SIDE[A]).modules, sa.modules, 'the archetype\'s non-empty list is never replaced (R40)');
  write(VOCAB, vocabRaw); write(GATED, gatedRaw);
  r = await run('--template', A);
  assert.equal(r.last, 'encoded 2 · unchanged 0 · stopped 0'); assert.deepEqual(json(SIDE[S1]).modules, ss.modules); assert.equal(read(DOC[S1]), docS);
  // a site input is in the key (siteSha): a media ledger edit is never "unchanged input"; only the page whose bytes
  // change is rewritten
  const LEDGER = 'stardust/deploy/media-ledger.json'; const ledgerRaw = read(LEDGER);
  const heroUrl = 'https://content.da.live/example-org/example-site/media/trips/forest-loop-hero-0c4d9e12.jpg'; const movedUrl = heroUrl.replace('.jpg', '-v2.jpg');
  write(LEDGER, ledgerRaw.replace(heroUrl, movedUrl));
  const s4 = stamp();
  r = await run('--template', A);
  assert.equal(r.code, 0, r.out); assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0', 'a ledger edit re-encodes');
  assert.ok(read(DOC[S1]).includes(movedUrl), 'the sibling carries the new contentUrl'); assert.equal(stamp()[DOC[A]], s4[DOC[A]], 'the archetype\'s document is not rewritten');
  write(LEDGER, ledgerRaw);
  r = await run('--template', A);
  assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0'); assert.equal(read(DOC[S1]), docS);

  // --- co-existence: migrate.mjs's sidecar subcommands between encodes --------------------------------------------
  const g = cli(MIGRATE, ['gate', S1, 'visual-parity', '--evidence', 'compared side by side']);
  assert.equal(g.status, 0, g.stderr);
  const sourceCurrentSha = createHash('sha1').update(readFileSync(P(`stardust/current/pages/${S1}.json`))).digest('hex').slice(0, 12);
  write(SIDE[S1], pretty({ ...json(SIDE[S1]), sourceCurrentSha })); // as migrate's render records it
  r = await run('--template', A);
  assert.equal(r.code, 0, `the guard covers the document only: a sidecar rewritten by migrate.mjs is never a hand edit\n${r.out}`);
  assert.deepEqual(json(SIDE[S1]).gatesPassed, ['visual-parity']);
  // R40: the archetype's modules[] (migrate.mjs modules records the model's ids) — an empty list is filled, a recorded
  // one is never replaced
  assert.equal(cli(MIGRATE, ['modules', A, '--clear']).status, 0);
  r = await run('--template', A, '--force'); assert.equal(r.code, 0, r.out);
  assert.deepEqual(json(SIDE[A]).modules, ['facts', 'hero', 'links', 'tabs', 'tags', 'teaser'], 'an empty archetype list is filled on a clean encode');
  assert.equal(cli(MIGRATE, ['modules', A, '--clear']).status, 0); assert.equal(cli(MIGRATE, ['modules', A, 'river-hero', 'trail-facts']).status, 0);
  r = await run('--template', A, '--force'); assert.equal(r.code, 0, r.out);
  assert.deepEqual(json(SIDE[A]).modules, ['river-hero', 'trail-facts'], 'the model\'s archetype modules survive a clean encode');

  // --- stale output: a stop after a clean encode ---------------------------------------------------------------------
  const cap = read(CAPTURE(S1)); const encBefore = json(SIDE[S1]).encode; const manifestBefore = read(MANIFEST);
  write(CAPTURE(S1), cap.replace('<div class="mod-image"', '<div class="mod-poll"><div class="ui-poll"><p>Which trail next?</p></div></div><div class="mod-image"'));
  r = await run('--template', A);
  assert.equal(r.code, 2); assert.equal(r.last, 'encoded 0 · unchanged 1 · stopped 1');
  assert.match(r.out, new RegExp(`✗ ${S1} unmapped[\\s\\S]*${DOC[S1]} \\(an earlier encode\\) is kept`), 'the run says the document on disk is an earlier encode');
  assert.equal(read(DOC[S1]), docS, 'the earlier document stays'); assert.equal(read(MANIFEST), manifestBefore, 'the manifest still records what the encoder wrote');
  let side = json(SIDE[S1]);
  assert.equal(side.audit.encode.status, 'unmapped', 'the sidecar records the stop'); assert.equal(side.audit.encode.unmapped.length, 1);
  assert.deepEqual(side.encode, encBefore, 'encode still describes the document on disk'); assert.deepEqual(side.gatesPassed, ['visual-parity']);
  assert.deepEqual([verdict().kind, verdict().ok, verdict().sha], ['stopped', false, sha256(docS)], 'currentEncode: stopped, the document stale');
  const staged = statSync(P('content/trips/forest-loop.html'));
  st = cli(STAGE, ['--template', A, '--root', T]);
  assert.equal(st.status, 0, `a stopped page is skipped and leaves the exit code alone (R28)\n${st.stderr}`);
  assert.match(st.stderr, new RegExp(`^- ${S1} skipped \\(stopped: unmapped\\)`, 'm')); assert.equal(st.stdout, '', 'nothing to deliver');
  assert.deepEqual([statSync(P('content/trips/forest-loop.html')).ino, statSync(P('content/trips/forest-loop.html')).mtimeMs], [staged.ino, staged.mtimeMs], 'its content/ document is not touched');
  rmSync(P(CAPTURE(S1)));
  r = await run('--template', A);
  assert.equal(r.code, 1, 'a missing capture is missing input'); assert.equal(json(SIDE[S1]).audit.encode.status, 'error', '… recorded as an error stop');
  write(CAPTURE(S1), cap);
  r = await run('--template', A, '--json');
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0');
  assert.ok(!r.pages.find((p) => p.slug === S1).skipped, 'a recorded stop never skips, even when the inputs match the last clean encode');
  side = json(SIDE[S1]);
  assert.equal(side.audit.encode.status, 'clean'); assert.deepEqual(side.encode, encBefore);
  st = cli(STAGE, ['--template', A, '--root', T]);
  assert.equal(st.status, 0, st.stderr);

  // --- hand-edit guard ------------------------------------------------------------------------------------------------
  const edited = docS.replace('<div class="teaser featured">', '<div class="teaser featured wide">');
  assert.notEqual(edited, docS);
  write(DOC[S1], edited);
  assert.equal(json(SIDE[S1]).audit.encode.status, 'clean');
  assert.equal(verdict().kind, 'stale', 'currentEncode: a hand edit under a clean status is stale'); assert.match(verdict().why, /encode\.output\.sha .*a hand edit/);
  st = cli(STAGE, ['--template', A, '--root', T]);
  assert.equal(st.status, 2, `staging refuses a stale (hand-edited) encoded document\n${st.stderr}`);
  assert.equal(read('content/trips/forest-loop.html'), docS, '… and writes nothing');
  const s3 = stamp();
  r = await run('--template', A);
  assert.equal(r.code, 2); assert.equal(r.last, 'encoded 0 · unchanged 1 · stopped 1');
  assert.match(r.out, new RegExp(`✗ ${S1} hand-edit\\n {4}hand-edit ${DOC[S1]} .*stardust/patches/${S1}\\.json.*--overwrite-hand-edit ${S1}`), 'the message names the path and the fix');
  assert.deepEqual(stamp(), s3, 'nothing written for the page'); assert.equal(read(DOC[S1]), edited);
  r = await run('--template', A, '--force');
  assert.equal(r.code, 2, '--force never overrides the guard'); assert.deepEqual(stamp(), s3);
  r = await run('--template', A, '--overwrite-hand-edit', S1);
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 1 · unchanged 1 · stopped 0'); assert.equal(read(DOC[S1]), docS, '--overwrite-hand-edit restores the clean encode');
  write(DOC[S1], edited);
  r = await run('--template', A); assert.equal(r.code, 2);
  write(PATCH, JSON.stringify([{ selector: '.teaser', op: 'attr', name: 'class', value: 'teaser featured wide' }]));
  r = await run('--template', A, '--json');
  assert.equal(r.code, 0, `the same edit as a patch passes\n${r.out}`); assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0', '… its bytes are the encode now: adopted, not rewritten');
  assert.equal(read(DOC[S1]), edited); assert.equal(json(MANIFEST)[DOC[S1]], sha256(edited));
  side = json(SIDE[S1]);
  assert.equal(side.encode.output.sha, sha256(edited)); assert.match(side.encode.inputs.patchesSha, SHA);
  assert.deepEqual(side.audit.encode.patchesApplied, [{ selector: '.teaser', op: 'attr', matched: 1 }]);
  assert.equal(side.sourceCurrentSha, sourceCurrentSha, 'sourceCurrentSha is never the encoder\'s to change'); assert.deepEqual(side.gatesPassed, ['visual-parity']);
  const patch = read(PATCH);
  write(PATCH, 'null');
  r = await run('--template', A, '--slug', S1, '--json');
  assert.equal(r.code, 2, 'a patch file holding JSON null is malformed'); assert.equal(r.pages[0].status, 'error');
  assert.match(r.pages[0].report.errors[0], new RegExp(`^stardust/patches/${S1}\\.json: a patch file holds an array`));
  write(PATCH, patch);

  // --- documents the manifest does not list: refused when they differ, adopted when byte-equal --------------------
  rmSync(P(MANIFEST));
  write(DOC[A], docA.replace('<h1>River Walk</h1>', '<h1>River Walk!</h1>'));
  r = await run('--template', A);
  assert.equal(r.code, 2); assert.match(r.out, new RegExp(`✗ ${A} hand-edit\\n {4}hand-edit ${DOC[A]} .*not in ${MANIFEST}`));
  assert.deepEqual(json(MANIFEST), { [DOC[S1]]: sha256(edited) }, 'the byte-equal sibling is adopted, the differing archetype is not');
  write(DOC[A], docA);
  r = await run('--template', A);
  assert.equal(r.code, 0); assert.equal(r.last, 'encoded 0 · unchanged 2 · stopped 0'); assert.deepEqual(Object.keys(json(MANIFEST)), [DOC[S1], DOC[A]]);

  rmSync(P(DOC[S1]));
  assert.deepEqual([verdict().kind, verdict().sha], ['missing', null], 'currentEncode: no document');
  r = await run('--template', A, '--overwrite-hand-edit', 'not-a-page');
  assert.equal(r.code, 1); assert.match(r.err, /--overwrite-hand-edit not-a-page: not a page of template/);
  assert.ok(!existsSync(P('stardust/migrated/trips/not-a-page._meta.json')));
} finally {
  rmSync(T, { recursive: true, force: true });
}
console.log('encode-provenance: ok');
