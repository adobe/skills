#!/usr/bin/env node
// gate-ledger-lint.mjs contract test — deterministic, no browser, no network.
// Runs the lint against the shared post-migrate fixture
// (evals/_shared/fixture-post-migrate/stardust) and five synthetic ledgers:
//   fixture  — exit 2; program blocked (never gated); article blocked (1440
//              11.6 % / 360 12.4 % over bar, residuals without artifacts[] /
//              acceptedBy); landing ok;
//   1440-only ledger with breakpointsConfigured [1440, 360] → "360 missing";
//   `pass: true` typed next to heightDelta 28 → blocked (the hand-typed case);
//   pageTypes{} alias accepted; unknown shape (pages{} + "4.02%") → exit 1;
//   over the bar with named-class residuals + artifacts[] + acceptedBy → ok,
//   hands-off-policy on a non-permanent class → blocked;
//   --published on a ledger without `published` → every bp ungated, exit 0,
//   coverage line; with one published PASS → counted;
//   register:R-nn with a trailing description is a named cause;
//   the gate doc's § Residual classes intro states the same cause grammar;
//   every residual class a sibling reference names is a table row; the embedded
//   RESIDUAL_CLASSES list equals the table and a project copy under
//   stardust/scripts/replica/ (no ../reference/) resolves it (exit 0, no WARN);
//   (motion-unassertable: valid with acceptedBy, refused under hands-off-policy);
//   --help exits 0; unknown flag exits 1.
// Usage: node plugins/stardust/skills/replica/scripts/gate-ledger-lint.test.mjs
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const LINT = join(HERE, 'gate-ledger-lint.mjs');
const FIXTURE = join(HERE, '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8', cwd }); return { status: r.status, out: `${r.stdout}\n${r.stderr}` }; };

const work = mkdtempSync(join(tmpdir(), 'gate-ledger-lint-'));
const ledgerFile = (name, obj) => { const p = join(work, `${name}.json`); writeFileSync(p, JSON.stringify(obj, null, 2)); return p; };
const good = (pct, dh) => ({ iterations: 2, result: { structuralRed: 0, pixelPct: pct, heightDelta: dh, pass: true }, residuals: [] });
const motion = { observed: [], implemented: [], dead: [] };

try {
  // --help / bad flag
  const help = run(['--help']);
  check(help.status === 0 && /Usage:/.test(help.out) && /--published/.test(help.out), 'gate-ledger-lint --help must exit 0 and print the usage');
  check(run(['--bogus']).status === 1, 'an unknown flag must exit 1');

  // shared fixture
  let r = run(['--progress', 'stardust/replica/progress.json', '--state', 'stardust/state.json', '--project', '.'], FIXTURE);
  check(r.status === 2, `fixture must exit 2 (blocked types present)\n${r.out}`);
  check(/^program: blocked — never gated.*→ \$stardust replica insurance__home$/m.test(r.out), `program blocked as never gated with the command\n${r.out}`);
  check(/^article: blocked — 1440 11\.6 % Δh 6 over bar, residuals without artifacts\[\], residuals without acceptedBy; 360 12\.4 % Δh -7 over bar, .*→ \$stardust replica news__storm-season-checklist$/m.test(r.out), `article blocked over the bar with the residual defects named\n${r.out}`);
  check(/^landing: ok — home 1440 2\.14 % Δh 0 · 360 3\.87 % Δh 4$/m.test(r.out), `landing ok with its ledger numbers\n${r.out}`);
  check(/3 type\(s\) checked, 2 blocked \(archetypes\[\]/.test(r.out), `summary names the shape and the counts\n${r.out}`);
  const rj = run(['--progress', 'stardust/replica/progress.json', '--state', 'stardust/state.json', '--json'], FIXTURE);
  let j = null; try { j = JSON.parse(rj.out.split('\n').filter((l) => !l.startsWith('gate-ledger-lint')).join('\n')); } catch { /* asserted below */ }
  check(rj.status === 2 && j?.results?.length === 3 && j.results.find((x) => x.type === 'landing')?.verdict === 'ok', `--json report carries the three verdicts\n${rj.out}`);
  // --types narrows; --all-types widens
  r = run(['--progress', 'stardust/replica/progress.json', '--types', 'landing'], FIXTURE);
  check(r.status === 0 && /1 type\(s\) checked, 0 blocked/.test(r.out), `--types landing alone must exit 0\n${r.out}`);

  // --published: reporting only
  r = run(['--progress', 'stardust/replica/progress.json', '--published'], FIXTURE);
  check(r.status === 0 && /^landing: published: 1440 ungated · 360 ungated \(home\)$/m.test(r.out) && /^archetypes published-gated 0 of 3 at 1440 · ungated: home@1440 news__storm-season-checklist@1440 insurance__home@1440$/m.test(r.out), `--published without published blocks → every bp ungated, exit 0, coverage line\n${r.out}`);

  // synthetic: 360 missing
  const p1 = ledgerFile('missing-360', { breakpointsConfigured: [1440, 360], archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: good(2, 1) } }] });
  r = run(['--progress', p1, '--all-types']);
  check(r.status === 2 && /landing: blocked — 360 missing/.test(r.out), `a configured breakpoint without a result must block as "<bp> missing"\n${r.out}`);

  // synthetic: pass:true typed next to Δh 28
  const p2 = ledgerFile('typed-pass', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: good(4, 28), 360: good(3, 0) } }] });
  r = run(['--progress', p2, '--all-types']);
  check(r.status === 2 && /1440 `pass: true` typed over the bar \(1440 Δh 28 over bar\)/.test(r.out) && /no residuals logged/.test(r.out), `pass:true with |Δh| > 8 must block (the bar is applied by the lint, not read from pass)\n${r.out}`);

  // synthetic: pageTypes{} alias, missing structuralRed → warning only
  const p3 = ledgerFile('pagetypes-map', { pageTypes: { landing: { archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: { result: { pixelPct: 1, heightDelta: 0, pass: true } }, 360: { result: { pixelPct: 1, heightDelta: 0, pass: true } } } } } });
  r = run(['--progress', p3, '--all-types']);
  check(r.status === 0 && /landing: ok — home/.test(r.out) && /warn: 1440 structuralRed absent/.test(r.out) && /\(pageTypes\{\}/.test(r.out), `pageTypes{} alias accepted; absent structuralRed warns, never blocks\n${r.out}`);

  // synthetic: unknown shape → exit 1
  const p4 = ledgerFile('unknown', { pages: { home: { '1440': { pixelDiff: '4.02%', verdict: 'pass' } } } });
  r = run(['--progress', p4, '--all-types']);
  check(r.status === 1 && /cannot verify — ledger shape/.test(r.out), `an unknown ledger shape must exit 1 loud, never pass\n${r.out}`);
  r = run(['--progress', join(work, 'nope.json')]);
  check(r.status === 1, 'a missing ledger must exit 1');

  // synthetic: over the bar with VALID named residuals → ok; hands-off-policy on a non-permanent class → blocked
  const valid = { result: { structuralRed: 0, pixelPct: 12, heightDelta: 2, pass: false }, residuals: [{ band: 'y 0–500', pct: 3, cause: 'glyph-antialiasing', artifacts: ['gates/home-1440/crop.png'], acceptedBy: 'hands-off-policy:glyph-antialiasing' }, { band: 'y 900–1200', pct: 9, cause: 'capture-state: CDN-403 tiles', artifacts: ['gates/home-1440/diff-iter3.png'], acceptedBy: 'user' }] };
  const p5 = ledgerFile('named', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: valid, 360: good(1, 0) } }] });
  r = run(['--progress', p5, '--all-types']);
  check(r.status === 0 && /landing: ok — home 1440 12 % Δh 2/.test(r.out), `over the bar with named classes + artifacts[] + acceptedBy is ok\n${r.out}`);
  const badPolicy = JSON.parse(JSON.stringify(valid)); badPolicy.residuals[1].cause = 'live-drift'; badPolicy.residuals[1].acceptedBy = 'hands-off-policy:live-drift';
  const p6 = ledgerFile('bad-policy', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: badPolicy, 360: good(1, 0) } }] });
  r = run(['--progress', p6, '--all-types']);
  check(r.status === 2 && /hands-off-policy on a non-permanent class/.test(r.out), `hands-off may self-accept only permanent classes\n${r.out}`);
  const unnamed = JSON.parse(JSON.stringify(valid)); unnamed.residuals[1].cause = 'looks like ghosting';
  const p7 = ledgerFile('unnamed', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: unnamed, 360: good(1, 0) } }] });
  r = run(['--progress', p7, '--all-types']);
  check(r.status === 2 && /residuals unnamed/.test(r.out), `a residual whose cause is not a class id or register:R-nn blocks\n${r.out}`);
  // defect: a register cause with a trailing description ("register:R-01 footer colour") split to id "register" and read as unnamed — class ids tolerate the description, so must register:R-nn
  const registered = JSON.parse(JSON.stringify(valid)); registered.residuals[1].cause = 'register:R-01 footer link colour'; registered.residuals[1].acceptedBy = 'register:R-01';
  const p7b = ledgerFile('registered', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: registered, 360: good(1, 0) } }] });
  r = run(['--progress', p7b, '--all-types']);
  check(r.status === 0 && /landing: ok — home/.test(r.out), `register:R-nn followed by a description is a named cause (same tolerance as "capture-state: …")\n${r.out}`);
  // doc/instrument agreement: the gate doc's § Residual classes intro must state the grammar the lint applies (class id | register:R-nn), not "a diagnosed cause in the page's own terms"
  const doc = readFileSync(join(HERE, '..', 'reference', 'source-fidelity-gate.md'), 'utf8');
  const intro = (doc.split(/^### Residual classes\s*$/m)[1] || '').split('\n| class id')[0];
  check(/register:R-nn/.test(intro) && !/own terms/.test(intro) && /class id from this table/.test(intro), `§ Residual classes intro must name the lint's cause grammar (class id | register:R-nn), not free-text causes\n${intro}`);
  // doc/doc agreement: every residual class a sibling doc names ("residual class `x`") is a row of the table — recreation-procedure.md named
  // `motion-unassertable` (behaviour-match escape) before the table had it, so the escape read "residuals unnamed" and blocked
  const { residualClasses } = await import(join(HERE, 'progress-record.mjs'));
  const classes = residualClasses();
  for (const f of ['recreation-procedure.md', 'preserve-direction.md']) {
    const named = [...readFileSync(join(HERE, '..', 'reference', f), 'utf8').matchAll(/residual class\s+`([a-z0-9-]+)`/g)].map((m) => m[1]);
    for (const id of named) check(classes.has(id), `${f} names residual class \`${id}\` but § Residual classes has no such row`);
  }
  check(classes.has('motion-unassertable') && classes.get('motion-unassertable').permanent === false, 'motion-unassertable is a table row and NOT permanent (interactive acceptance only — hands-off never self-accepts it)');
  // embedded list ↔ doc table parity (the project copy under stardust/scripts/replica/ has no ../reference/ and reads the embedded list)
  const { RESIDUAL_CLASSES, parseResidualClasses } = await import(join(HERE, 'progress-record.mjs'));
  const table = parseResidualClasses(doc);
  check(classes.source === 'doc' && table.size === classes.size, `residualClasses() beside the plugin reads the doc table (${classes.size} rows)`);
  check(RESIDUAL_CLASSES.length === table.size && RESIDUAL_CLASSES.every(([id, permanent]) => table.has(id) && table.get(id).permanent === permanent), `progress-record.mjs RESIDUAL_CLASSES must equal § Residual classes (id + permanent): embedded ${JSON.stringify(RESIDUAL_CLASSES)} vs doc ${JSON.stringify([...table].map(([id, v]) => [id, v.permanent]))}`);
  // defect: from the project copy residualClasses() returned an empty map — every named residual read "unnamed", `accepted` read `fail`
  const copy = join(work, 'project', 'stardust', 'scripts', 'replica');
  mkdirSync(copy, { recursive: true });
  for (const f of ['gate-ledger-lint.mjs', 'progress-record.mjs']) writeFileSync(join(copy, f), readFileSync(join(HERE, f)));
  const rc = spawnSync(process.execPath, [join(copy, 'gate-ledger-lint.mjs'), '--progress', p5, '--all-types'], { encoding: 'utf8' });
  check(rc.status === 0 && /landing: ok — home 1440 12 % Δh 2/.test(`${rc.stdout}${rc.stderr}`) && !/WARN/.test(rc.stderr), `the project copy (stardust/scripts/replica/, no ../reference/) still resolves the class list: named residuals ok, exit 0, no WARN — got ${rc.status}\n${rc.stdout}${rc.stderr}`);
  const copied = spawnSync(process.execPath, ['--input-type=module', '-e', `import { residualClasses } from ${JSON.stringify(join(copy, 'progress-record.mjs'))}; const c = residualClasses(); console.log(JSON.stringify({ source: c.source, size: c.size, cs: c.get('capture-state') }));`], { encoding: 'utf8' });
  check(/"source":"embedded","size":18,"cs":\{"permanent":false\}/.test(copied.stdout), `the copied reader reports source embedded with the full list, got ${copied.stdout}${copied.stderr}`);
  const unassertable = JSON.parse(JSON.stringify(valid)); unassertable.residuals[1].cause = 'motion-unassertable: prototype server unreachable from the headless run'; unassertable.residuals[1].acceptedBy = 'user';
  const p7c = ledgerFile('unassertable', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: unassertable, 360: good(1, 0) } }] });
  r = run(['--progress', p7c, '--all-types']);
  check(r.status === 0 && /landing: ok — home/.test(r.out), `motion-unassertable with artifacts[] + acceptedBy is a named, valid residual\n${r.out}`);
  unassertable.residuals[1].acceptedBy = 'hands-off-policy:motion-unassertable';
  const p7d = ledgerFile('unassertable-handsoff', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', motion, breakpoints: { 1440: unassertable, 360: good(1, 0) } }] });
  r = run(['--progress', p7d, '--all-types']);
  check(r.status === 2 && /hands-off-policy on a non-permanent class/.test(r.out), `hands-off cannot self-accept motion-unassertable\n${r.out}`);

  // synthetic: motion inventory missing; roster from state.json pages (type with no sibling is not checked)
  const p8 = ledgerFile('motion', { archetypes: [{ pageType: 'landing', archetype: 'home', prototype: 'x.html', breakpoints: { 1440: good(1, 0), 360: good(1, 0) } }, { pageType: 'program', archetype: 'prog', prototype: 'y.html', motion, breakpoints: {} }] });
  const st = ledgerFile('state', { pages: [{ slug: 'home', type: 'landing' }, { slug: 'about', type: 'landing' }, { slug: 'prog', type: 'program' }] });
  r = run(['--progress', p8, '--state', st]);
  check(r.status === 2 && /landing: blocked — motion inventory missing/.test(r.out) && !/program:/.test(r.out) && /1 type\(s\) checked/.test(r.out), `motion inventory is required; a type without siblings is outside the roster\n${r.out}`);

  // --published with one PASS
  const p9 = ledgerFile('published', { archetypes: [{ pageType: 'landing', archetype: 'home', published: { 1440: { result: { pixelPct: 6.5, heightDelta: 2, pass: true, structuralRed: 0 }, url: 'https://x.aem.page/' } } }, { pageType: 'article', archetype: 'post', published: { 1440: { result: { pixelPct: 14, heightDelta: 2 } } } }] });
  r = run(['--progress', p9, '--published']);
  check(r.status === 0 && /^landing: published: 1440 PASS 6\.5 % Δh 2 · 360 ungated \(home\)$/m.test(r.out) && /^article: published: 1440 FAIL 14 % Δh 2 · 360 ungated \(post\)$/m.test(r.out) && /^archetypes published-gated 1 of 2 at 1440$/m.test(r.out) && /^archetypes published-gated 0 of 2 at 360 · ungated: home@360 post@360$/m.test(r.out), `--published judges published.<bp> by the same bars and counts coverage per bp\n${r.out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) { console.error(`gate-ledger-lint.test: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log('gate-ledger-lint.test: ok (shared fixture 2 blocked / landing ok, --json, --types, --published coverage, 360 missing, typed pass over Δh, pageTypes{} alias, unknown shape exit 1, named residuals ok / hands-off-policy permanent only / unnamed blocked, motion + roster, --help)');
