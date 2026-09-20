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
//   --progress → exit 2 (BLOCKING): a `gated` row whose gates.<bp> artefact is
//     absent at either breakpoint (a typed word, no crop) blocks and names the
//     breakpoint (defect fixture: checkProgress accepted `rest: "gated"` alone);
//     `lsg-legacy` has no row, `unfingerprinted` is
//                blocked; with rows for both and the old record removed → exit 0;
//                a row whose state word is outside gated | dead | unprobed:<reason>
//                → exit 2 naming it; a row without `rest` → exit 2;
//   --help exits 0; an unknown flag exits 1; a trailing value flag exits 1
//   ("needs a value"); a missing pages dir exits 1; records are read sorted.
// Usage: node plugins/stardust/evals/lint/chrome-variants-fixtures.mjs
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SCRIPT = resolve(HERE, '..', '..', 'skills', 'replica', 'scripts', 'chrome-variants.mjs');
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
  const trailing = run(['--pages']);
  check(trailing.status === 1 && /--pages needs a value/.test(trailing.out), 'a trailing value flag is refused with "needs a value"');
  check(run(['--pages', '--json', '--state', state]).status === 1, 'a value flag followed by another flag is refused, not consumed');
  check(run(['--pages', join(work, 'nope'), '--state', state]).status === 1, 'a missing pages dir exits 1');

  const { fingerprintOf, bucketPages, checkProgress, gateArtefactOk } = await import(SCRIPT);
  const P = (f) => JSON.parse(readFileSync(join(pages, f), 'utf8'));
  check(fingerprintOf(P('index.json')).key === fingerprintOf(P('about.json')).key, 'state classes and cache-busted stylesheet hashes do not split a fingerprint');
  check(fingerprintOf(P('index.json')).key !== fingerprintOf(P('legal.json')).key, 'a different header class set / nav rows / stylesheet is a different fingerprint');
  check(fingerprintOf(P('old.json')) === null, 'a record without the chrome field has no fingerprint');

  const inv = run(['--pages', pages, '--state', state, '--json'], work);
  check(inv.status === 0, `inventory exits 0 (got ${inv.status}): ${inv.out.slice(-300)}`);
  const j = JSON.parse(inv.stdout);
  const byName = Object.fromEntries(j.variants.map((v) => [v.name, v]));
  check(j.variants.length === 3 && byName.default && byName['lsg-legacy'] && byName.unfingerprinted, `2 variants + unfingerprinted, home bucket = default, persisted name kept (got ${j.variants.map((v) => v.name).join(', ')})`);
  check(byName.default && byName.default.pages === 2 && byName.default.sample.join(',') === 'about,index', `default holds about + index in sorted record order — never the directory listing's (got ${JSON.stringify(byName.default && byName.default.sample)})`);
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
  // evidence first: the fixture's default row says `gated` and names gates.1440/360 artefacts that do not exist yet → blocked, naming both breakpoints
  const g0 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g0.status === 2 && /default: state\(s\) marked gated without evidence: gates\.1440 \/ gates\.360/.test(g0.out), `a gated row without its chrome-states artefacts blocks and names the breakpoints (got ${g0.status}): ${g0.out.slice(-400)}`);
  const artefact = (slug, w) => { const d = join(work, 'gates', `${slug}-${w}`, 'chrome-states'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'chrome-states.json'), JSON.stringify({ schema: 1, live: 'https://s/', cells: [] })); };
  artefact('index', 1440);
  const g0b = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g0b.status === 2 && /gates\.360 missing/.test(g0b.out) && !/gates\.1440 \//.test(g0b.out), 'one breakpoint gated, the other not → still blocked, only the missing one named');
  artefact('index', 360);
  const g1 = run(['--pages', pages, '--state', state, '--progress', progress], work);
  check(g1.status === 2 && /lsg-legacy: no chrome archetype row/.test(g1.out) && /unfingerprinted:/.test(g1.out) && !/^  default: /m.test(g1.out), `missing row + unfingerprinted → exit 2 naming both, the evidenced default row passes (got ${g1.status}): ${g1.out.slice(-400)}`);
  const pj = JSON.parse(readFileSync(progress, 'utf8'));
  pj.chrome.variants.push({ name: 'lsg-legacy', pages: 1, archetype: 'legal', states: { rest: 'gated', scrolled: 'dead', 'menu:Insurance': 'unprobed:bot challenge at tier 3' }, gates: { 1440: 'gates/legal-1440/chrome-states', 360: 'gates/legal-360/chrome-states/chrome-states.json' } });
  writeFileSync(progress, JSON.stringify(pj));
  check(run(['--pages', pages, '--state', state, '--progress', progress], work).status === 2, 'the new row without artefacts blocks too');
  artefact('legal', 1440); artefact('legal', 360); // a directory path and a file path both resolve
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
  check(checkProgress(bucketPages([P('index.json')]), { chrome: { variants: [{ name: 'default', states: { rest: 'gated' } }] } }).ok === false, 'checkProgress: a word-only `rest: gated` row (no gates{}) is BLOCKED — the typed word is not a crop');
  check(checkProgress(bucketPages([P('index.json')]), { chrome: { variants: [{ name: 'default', states: { rest: 'dead', scrolled: 'unprobed:auth wall' } }] } }).ok === true, 'checkProgress: a row with no gated state needs no artefact');
  check(checkProgress(bucketPages([P('index.json')]), { breakpointsConfigured: [1440], chrome: { variants: [{ name: 'default', states: { rest: 'gated' }, gates: { 1440: 'gates/index-1440/chrome-states' } }] } }, { root: work }).ok === true, 'checkProgress: gates.<bp> honoured per breakpointsConfigured, a directory path resolves to its chrome-states.json');
  check(gateArtefactOk('gates/index-1440/chrome-states/chrome-states.json', work) && !gateArtefactOk('gates/nope/chrome-states.json', work) && !gateArtefactOk(null, work), 'gateArtefactOk: file / missing / null');
  // defect: `{}` and `[]` passed as evidence (schema undefined was accepted) — the header promises chrome-states.json with schema: 1
  for (const [name, body] of [['empty', '{}'], ['array', '[]'], ['schemaless', '{"cells":[]}'], ['nocells', '{"schema":1}']]) {
    const d = join(work, 'gates', `${name}-1440`); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'chrome-states.json'), body);
    check(!gateArtefactOk(`gates/${name}-1440`, work), `gateArtefactOk: ${body} is not a chrome-states report — no evidence`);
  }
  check(checkProgress(bucketPages([P('index.json')]), { breakpointsConfigured: [1440], chrome: { variants: [{ name: 'default', states: { rest: 'gated' }, gates: { 1440: 'gates/empty-1440' } }] } }, { root: work }).ok === false, 'checkProgress: a gated row pointing at an empty-object chrome-states.json is BLOCKED');
  // persisted names win over default: a home bucket already named keeps its name and nobody else becomes default
  const b = bucketPages([P('index.json'), P('legal.json')], { index: 'main' });
  check(b.find((x) => x.pages.some((p) => p.slug === 'index')).name === 'main' && !b.some((x) => x.name === 'default'), 'a persisted home name is kept and default is not handed to another bucket');
} finally { rmSync(work, { recursive: true, force: true }); }

if (failures.length) { console.error(`chrome-variants-fixtures: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('chrome-variants-fixtures: ok (fingerprint stability, buckets + names, marker candidates, --write, gate exit 2 / 0, gated-word evidence per breakpoint (schema 1 + cells[] required), state vocabulary, --help)');
