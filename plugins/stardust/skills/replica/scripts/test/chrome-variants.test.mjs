#!/usr/bin/env node
// chrome-variants.mjs contract test — deterministic, no browser, no network.
// Fixture (fixtures/chrome-variants): four page records — two share a chrome
// fingerprint (one carries a state class `is-sticky` and a different
// cache-busted main.css hash: must NOT split), one has a legacy header /
// footer / second nav row / extra stylesheet (a second variant, with a
// persisted name in state.json), one predates the `chrome` field.
//   inventory  → 2 variants + unfingerprinted; the home bucket is `default`,
//                the persisted name `lsg-legacy` is kept (never renumbered);
//                marker candidates name the template body class only;
//   --write    → state.json.pages[].chromeVariant set for fingerprinted pages only;
//   --progress → exit 2 (BLOCKING): `lsg-legacy` has no row, `unfingerprinted` is
//                blocked; with rows for both and the old record removed → exit 0;
//                a row whose state word is outside gated | dead | unprobed:<reason>
//                → exit 2 naming it; a row without `rest` → exit 2;
//   --help exits 0; an unknown flag exits 1; a missing pages dir exits 1.
// Usage: node plugins/stardust/skills/replica/scripts/test/chrome-variants.test.mjs
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SCRIPT = resolve(HERE, '..', 'chrome-variants.mjs');
const FIXTURE = join(HERE, 'fixtures', 'chrome-variants');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd }); return { status: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout }; };

const work = mkdtempSync(join(tmpdir(), 'chrome-variants-'));
cpSync(FIXTURE, work, { recursive: true });
const pages = join(work, 'pages'); const state = join(work, 'state.json'); const progress = join(work, 'progress.json');
try {
  check(run(['--help']).status === 0 && /--progress/.test(run(['--help']).out), '--help exits 0 and names --progress');
  check(run(['--bogus']).status === 1, 'an unknown flag exits 1');
  check(run(['--pages', join(work, 'nope'), '--state', state]).status === 1, 'a missing pages dir exits 1');

  const { fingerprintOf, bucketPages, checkProgress } = await import(SCRIPT);
  const P = (f) => JSON.parse(readFileSync(join(pages, f), 'utf8'));
  check(fingerprintOf(P('index.json')).key === fingerprintOf(P('about.json')).key, 'state classes and cache-busted stylesheet hashes do not split a fingerprint');
  check(fingerprintOf(P('index.json')).key !== fingerprintOf(P('legal.json')).key, 'a different header class set / nav rows / stylesheet is a different fingerprint');
  check(fingerprintOf(P('old.json')) === null, 'a record without the chrome field has no fingerprint');

  const inv = run(['--pages', pages, '--state', state, '--json'], work);
  check(inv.status === 0, `inventory exits 0 (got ${inv.status}): ${inv.out.slice(-300)}`);
  const j = JSON.parse(inv.stdout);
  const byName = Object.fromEntries(j.variants.map((v) => [v.name, v]));
  check(j.variants.length === 3 && byName.default && byName['lsg-legacy'] && byName.unfingerprinted, `2 variants + unfingerprinted, home bucket = default, persisted name kept (got ${j.variants.map((v) => v.name).join(', ')})`);
  check(byName.default && byName.default.pages === 2 && byName.default.sample.includes('index') && byName.default.sample.includes('about'), 'default holds index + about');
  check(byName.default && byName.default.markerCandidates.includes('tpl-main') && !byName.default.markerCandidates.includes('page-home') && !byName.default.markerCandidates.includes('page'), `marker candidates = body classes common to the bucket and absent elsewhere (got ${JSON.stringify(byName.default && byName.default.markerCandidates)})`);
  check(byName['lsg-legacy'] && byName['lsg-legacy'].markerCandidates.includes('tpl-legacy'), 'the legacy bucket names its template class');
  check(j.gate === null, 'no --progress → no gate verdict');
  const text = run(['--pages', pages, '--state', state], work);
  check(/more than one chrome variant/.test(text.out) && /chrome-variant/.test(text.out) && /never page-local CSS/.test(text.out), 'a second variant prints the decision-row line and the never-page-local rule');
  check(/probe once: node stardust\/scripts\/replica\/chrome-states\.mjs/.test(text.out), 'each bucket prints the one-probe command');

  // --write
  const w = run(['--pages', pages, '--state', state, '--write'], work);
  check(w.status === 0, `--write exits 0 (got ${w.status})`);
  const st = JSON.parse(readFileSync(state, 'utf8'));
  const cv = Object.fromEntries(st.pages.map((p) => [p.slug, p.chromeVariant || null]));
  check(cv.index === 'default' && cv.about === 'default' && cv.legal === 'lsg-legacy' && cv.old === null, `--write stores chromeVariant per fingerprinted page (got ${JSON.stringify(cv)})`);

  // the gate — BLOCKING branch
  const g1 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g1.status === 2 && /lsg-legacy: no chrome archetype row/.test(g1.out) && /unfingerprinted:/.test(g1.out), `missing row + unfingerprinted → exit 2 naming both (got ${g1.status}): ${g1.out.slice(-400)}`);
  const pj = JSON.parse(readFileSync(progress, 'utf8'));
  pj.chrome.variants.push({ name: 'lsg-legacy', pages: 1, archetype: 'legal', states: { rest: 'gated', scrolled: 'dead', 'menu:Insurance': 'unprobed:bot challenge at tier 3' } });
  writeFileSync(progress, JSON.stringify(pj));
  const g2 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g2.status === 2 && !/lsg-legacy:/.test(g2.out) && /unfingerprinted:/.test(g2.out), 'with both rows only the unfingerprinted bucket still blocks');
  rmSync(join(pages, 'old.json'));
  const g3 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g3.status === 0 && /fan-out may proceed/.test(g3.out), `both variants rowed, no unfingerprinted → exit 0 (got ${g3.status}): ${g3.out.slice(-300)}`);
  pj.chrome.variants[1].states['menu:Insurance'] = 'maybe';
  writeFileSync(progress, JSON.stringify(pj));
  const g4 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g4.status === 2 && /outside gated \| dead \| unprobed/.test(g4.out) && /menu:Insurance=maybe/.test(g4.out), 'a state word outside the vocabulary blocks and is named');
  delete pj.chrome.variants[1].states['menu:Insurance']; delete pj.chrome.variants[1].states.rest;
  writeFileSync(progress, JSON.stringify(pj));
  check(run(['--pages', pages, '--state', state, '--progress', progress], work).status === 2, 'a row without the rest state blocks');
  check(checkProgress(bucketPages([P('index.json')]), { chrome: { variants: [{ name: 'default', states: { rest: 'gated' } }] } }).ok === true, 'checkProgress: a rest-gated row passes');
  // persisted names win over default: a home bucket already named keeps its name and nobody else becomes default
  const b = bucketPages([P('index.json'), P('legal.json')], { index: 'main' });
  check(b.find((x) => x.pages.some((p) => p.slug === 'index')).name === 'main' && !b.some((x) => x.name === 'default'), 'a persisted home name is kept and default is not handed to another bucket');
} finally { rmSync(work, { recursive: true, force: true }); }

if (failures.length) { console.error(`chrome-variants.test: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('chrome-variants.test: ok (fingerprint stability, buckets + names, marker candidates, --write, gate exit 2 / 0, state vocabulary, --help)');
