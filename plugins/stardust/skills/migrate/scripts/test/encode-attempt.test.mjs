// Contract test for encode-attempt.mjs — a mkdtemp project and a FAKE encoder script (exit 0 / 2 / 1 by
// template, a slow template for the timeout, a marker line appended per run). Covers: record → encoded /
// no-roundtrip / exit 1 / timeout; an explicit --encoder that does not exist → usage error, nothing written; the
// default lookup with no encoder (the project-copy layout) → not-attempted; no map → not-attempted with the encoder
// never run; --not-attempted
// (reason required); template names that could leave the record directory; check (missing / malformed →
// exit 2 naming the command, present → 0); summary counts (text and --json); deterministic bytes and key
// order; the exported library; importing is silent.
// Run: node skills/migrate/scripts/test/encode-attempt.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readAttempt, recordAttempt, Refusal, requireEncodeAttempt, siblingsOf, summaryLine, UsageError } from '../encode-attempt.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'encode-attempt.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'encode-attempt-test-'));
let failed = 0; let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`); }
}
const run = (args, script = SCRIPT, cwd = tmp) => { const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const write = (rel, data) => { const f = join(tmp, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); return f; };
const has = (rel) => existsSync(join(tmp, rel));
const read = (rel) => readFileSync(join(tmp, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const REC = (t) => `stardust/migrate/encode/${t}.json`;
const MARKER = 'encoder-runs.log';
const runs = () => (has(MARKER) ? read(MARKER).split('\n').filter(Boolean) : []);
const CMD = 'node stardust/scripts/migrate/encode-attempt.mjs record --template';

// ---- fixture: the project and a fake encoder ---------------------------------------------------
const ROOT = join(tmp, 'project');
const map = (t) => { const f = join(ROOT, 'stardust', 'import', t, 'vocabulary.json'); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, '{}\n'); };
for (const t of ['good', 'diff', 'nogated', 'slow']) map(t);
const FAKE = write('fake-encode.mjs', `
import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2);
const mode = a[0]; const t = a[a.indexOf('--template') + 1]; const root = a[a.indexOf('--root') + 1];
appendFileSync(${JSON.stringify(join(tmp, MARKER))}, \`\${mode} \${t} \${root}\\n\`);
if (mode === '--lint') { console.log('lint ' + t + ': step one'); console.log(t === 'diff' ? 'lint diff: 2 findings · 0 notes' : 'lint ' + t + ': 0 findings · 1 notes'); process.exit(t === 'diff' ? 1 : 0); }
if (t === 'slow') { setTimeout(() => process.exit(0), 20000); }
else if (t === 'good') { console.log('walking'); console.log('roundtrip good at text: equal — content/index.html'); process.exit(0); }
else if (t === 'diff') { console.log('roundtrip diff at text: not equal (3 differences) — content/diff.html'); process.exit(2); }
else { console.error('encode: no gated document for ' + t); process.exit(1); }
`);
const rec = (t, extra = []) => run(['record', '--template', t, '--root', ROOT, '--encoder', FAKE, ...extra]);
const P = (rel) => join('project', rel);

// ---- importing / help -------------------------------------------------------------------------
console.log('import / help');
check('importing encode-attempt.mjs prints nothing and does not exit; --help and no arguments print the usage', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log('imported');`], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'imported\n'); assert.equal(r.stderr, '');
  for (const args of [['--help'], []]) { const h = run(args); assert.equal(h.status, 0); assert.match(h.out, /Usage:/); assert.match(h.out, /Exit:/); }
});

// ---- record --------------------------------------------------------------------------------------
console.log('record');
check('roundtrip exit 0 → encoded, roundtrip and lint keep the exit code and the LAST stdout line, one stdout line', () => {
  const r = rec('good'); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt good: encoded — roundtrip good at text: equal — content/index.html\n');
  const j = json(P(REC('good')));
  assert.equal(j.template, 'good'); assert.equal(j.verdict, 'encoded'); assert.equal(j.reason, null);
  assert.deepEqual(j.roundtrip, { exit: 0, line: 'roundtrip good at text: equal — content/index.html' });
  assert.deepEqual(j.lint, { exit: 0, line: 'lint good: 0 findings · 1 notes' });
  assert.equal(j._provenance.writtenBy, 'stardust:migrate/encode-attempt'); assert.match(j._provenance.writtenAt, /^\d{4}-\d\d-\d\dT/); assert.match(j.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(runs().slice(-2), [`--roundtrip good ${ROOT}`, `--lint good ${ROOT}`], 'both modes run with --template and --root');
});
check('roundtrip exit 2 → no-roundtrip, reason = its line; lint exit 1 recorded', () => {
  const r = rec('diff'); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt diff: no-roundtrip — roundtrip diff at text: not equal (3 differences) — content/diff.html\n');
  const j = json(P(REC('diff')));
  assert.equal(j.verdict, 'no-roundtrip'); assert.equal(j.reason, 'roundtrip diff at text: not equal (3 differences) — content/diff.html');
  assert.deepEqual(j.roundtrip, { exit: 2, line: 'roundtrip diff at text: not equal (3 differences) — content/diff.html' });
  assert.deepEqual(j.lint, { exit: 1, line: 'lint diff: 2 findings · 0 notes' });
});
check('roundtrip exit 1 (no gated document) → no-roundtrip, the reason names the exit and the stderr line', () => {
  const r = rec('nogated'); assert.equal(r.status, 0, r.err);
  const j = json(P(REC('nogated')));
  assert.equal(j.verdict, 'no-roundtrip'); assert.deepEqual(j.roundtrip, { exit: 1, line: null });
  assert.match(j.reason, /exit 1/); assert.match(j.reason, /no gated document for nogated/);
  assert.match(r.out, /^encode-attempt nogated: no-roundtrip — .*exit 1/);
});
check('several templates in one call (comma list) → one line each, in the given order', () => {
  const r = rec('diff,good'); assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n').map((l) => l.split(':')[0]), ['encode-attempt diff', 'encode-attempt good']);
});
check('an explicit --encoder that does not exist (a typo) → usage error, exit 2, nothing run and nothing written (the library throws)', () => {
  const before = runs().length; const kept = read(P(REC('good'))); map('typo');
  const missing = join(tmp, 'no-such-encode.mjs');
  const r = run(['record', '--template', 'good,typo', '--root', ROOT, '--encoder', missing]); assert.equal(r.status, 2);
  assert.equal(r.out, ''); assert.equal(r.err, `usage error: --encoder ${missing} does not exist\n`);
  assert.equal(read(P(REC('good'))), kept, 'an earlier record stays as it was'); assert.ok(!has(P(REC('typo'))), 'no record written');
  assert.throws(() => recordAttempt(ROOT, 'typo', { encoder: missing }), (e) => e instanceof UsageError && e.message === `--encoder ${missing} does not exist`);
  assert.ok(!has(P(REC('typo'))), 'no record written by the library either');
  assert.equal(runs().length, before);
  rmSync(join(ROOT, 'stardust', 'import', 'typo'), { recursive: true });
});
check('the default encoder lookup (project-copy layout, no encode.mjs beside the script) → not-attempted, the brief\'s reason', () => {
  const copy = join(tmp, 'copy', 'stardust', 'scripts', 'migrate'); mkdirSync(copy, { recursive: true });
  copyFileSync(SCRIPT, join(copy, 'encode-attempt.mjs'));
  const r = run(['record', '--template', 'diff', '--root', ROOT], join(copy, 'encode-attempt.mjs')); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt diff: not-attempted — encode.mjs not found beside this script\n');
  assert.equal(json(P(REC('diff'))).reason, 'encode.mjs not found beside this script');
  rec('diff');
});
check('no map at stardust/import/<t>/vocabulary.json → not-attempted naming the map, the encoder never run (marker absent)', () => {
  const before = runs().length;
  const r = rec('nomap'); assert.equal(r.status, 0, r.err);
  const j = json(P(REC('nomap')));
  assert.equal(j.verdict, 'not-attempted'); assert.equal(j.roundtrip, null); assert.equal(j.lint, null);
  assert.equal(j.reason, 'no map at stardust/import/nomap/vocabulary.json — the encoder needs the template\'s map');
  assert.equal(runs().length, before); assert.ok(!runs().some((l) => l.includes(' nomap ')));
});
check('--not-attempted "<reason>" records the owner decision without running anything', () => {
  const before = runs().length;
  const r = run(['record', '--template', 'owner', '--root', ROOT, '--not-attempted', 'the module grammar is not mapped yet']); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt owner: not-attempted — the module grammar is not mapped yet\n');
  const j = json(P(REC('owner')));
  assert.equal(j.verdict, 'not-attempted'); assert.equal(j.reason, 'the module grammar is not mapped yet'); assert.equal(j.roundtrip, null); assert.equal(j.lint, null);
  assert.equal(runs().length, before);
});
check('--not-attempted without a (non-empty) reason → exit 2, nothing written', () => {
  for (const extra of [['--not-attempted'], ['--not-attempted', ''], ['--not-attempted', '   '], ['--not-attempted', '--root', ROOT]]) {
    const r = run(['record', '--template', 'blank', '--root', ROOT, ...extra]);
    assert.equal(r.status, 2, `${extra.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, /not-attempted/);
  }
  assert.ok(!has(P(REC('blank'))));
});
check('a template name that could leave the record directory → exit 2, nothing written', () => {
  for (const t of ['../escape', '..', '.', 'a/b', 'a\\b', '']) {
    const r = run(['record', '--template', t, '--root', ROOT, '--not-attempted', 'x']);
    assert.equal(r.status, 2, `${JSON.stringify(t)}: ${r.out}${r.err}`);
  }
  assert.ok(!has(P('stardust/migrate/escape.json'))); assert.ok(!has(P('stardust/migrate/encode/...json')));
  // migrate.mjs plan maps this class to one clean line, so the library throws the exported UsageError.
  assert.throws(() => recordAttempt(ROOT, '../escape', { notAttempted: 'x' }), (e) => e instanceof UsageError && /template/.test(e.message));
});
check('usage errors → exit 2: no --template, unknown command, unknown flag, a --root that is not a directory', () => {
  assert.equal(run(['record', '--root', ROOT]).status, 2);
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['record', '--template', 'good', '--root', ROOT, '--bogus', 'x']).status, 2);
  assert.equal(run(['check', '--template', 'good', '--root', ROOT, '--encoder', FAKE]).status, 2, 'check takes no --encoder');
  assert.equal(run(['record', '--template', 'good', '--root', join(tmp, 'no-such-root'), '--not-attempted', 'x']).status, 2);
  assert.ok(!has('no-such-root'));
});

// ---- check ----------------------------------------------------------------------------------------
console.log('check');
check('every named template recorded → exit 0, one line', () => {
  const r = run(['check', '--template', 'good,diff,owner', '--root', ROOT]);
  assert.equal(r.status, 0, r.err); assert.equal(r.out, 'encode-attempt: 3 template(s) recorded\n');
});
check('a template without a record, or with a malformed one → exit 2, one line each naming the command to run', () => {
  write(P(REC('broken')), '{ not json');
  write(P(REC('odd')), JSON.stringify({ template: 'odd', verdict: 'maybe' }));
  write(P(REC('other')), JSON.stringify({ template: 'good', verdict: 'encoded' }));
  const r = run(['check', '--template', 'good,missing,broken,odd,other', '--root', ROOT]);
  assert.equal(r.status, 2);
  for (const t of ['missing', 'broken', 'odd', 'other']) assert.ok(r.err.includes(`encode-attempt ${t}: no attempt record — run: ${CMD} ${t}\n`), `${t}: ${r.err}`);
  assert.ok(!r.err.includes('encode-attempt good:'));
  rmSync(join(ROOT, REC('odd'))); rmSync(join(ROOT, REC('other')));
});

// ---- summary --------------------------------------------------------------------------------------
console.log('summary');
check('summary counts encoded vs A′ (no-roundtrip + not-attempted); a malformed record is not counted', () => {
  // good: encoded · diff, nogated: no-roundtrip · nomap, owner: not-attempted · broken: malformed
  const r = run(['summary', '--root', ROOT]); assert.equal(r.status, 0, r.err);
  assert.equal(r.out.split('\n').at(-2), 'encode: 1 encoded · 4 A′ (2 no-roundtrip, 2 not-attempted, 0 hand-authored)', 'the totals line comes last');
  assert.match(r.err, /broken/);
});
check('summary --json: counts + per-template verdicts sorted by template', () => {
  const r = run(['summary', '--root', ROOT, '--json']); assert.equal(r.status, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.encoded, 1); assert.equal(j.aPrime, 4); assert.equal(j.noRoundtrip, 2); assert.equal(j.notAttempted, 2); assert.equal(j.handAuthored, 0); assert.equal(j.total, 5);
  assert.deepEqual(j.templates.map((t) => [t.template, t.verdict]), [['diff', 'no-roundtrip'], ['good', 'encoded'], ['nogated', 'no-roundtrip'], ['nomap', 'not-attempted'], ['owner', 'not-attempted']]);
});
check('summary of a project with no record directory → all zero, exit 0', () => {
  const empty = join(tmp, 'empty'); mkdirSync(empty);
  const r = run(['summary', '--root', empty]); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode: 0 encoded · 0 A′ (0 no-roundtrip, 0 not-attempted, 0 hand-authored)\n');
});
check('summary per template (the roster report\'s line): siblings · encoded · slot-rendered · hand-authored · not-attempted, from the state, the sidecars and the record', () => {
  const proj = join(tmp, 'roster'); const put = (rel, data) => { const f = join(proj, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`); };
  put('stardust/state.json', { pages: ['tours', 'a', 'b', 'c', 'd', 'e'].map((x) => ({ slug: x, url: `https://example.test/${x}/`, status: x === 'tours' ? 'approved' : 'directed', type: 'tour' })).concat([{ slug: 'solo', status: 'approved', type: 'solo' }]), migrate: { outputDir: 'stardust/migrated/' } });
  put('stardust/migrated/tours/a/_meta.json', { slug: 'a', renderBranch: null, encode: { output: { path: 'x' } }, audit: { encode: { status: 'clean' } } });
  put('stardust/migrated/tours/b/_meta.json', { slug: 'b', renderBranch: "A'", slotSource: 'page-json' });
  put('stardust/migrated/tours/c._meta.json', { slug: 'c', renderBranch: "A'", slotSource: null });
  put('stardust/migrated/tours/e/_meta.json', { slug: 'e', renderBranch: "A'", slotSource: null });
  put('stardust/migrated/tours/stop/_meta.json', { slug: 'd', encode: { output: { path: 'y' } }, audit: { encode: { status: 'variance' } } });
  recordAttempt(proj, 'tours', { handAuthored: true, reason: 'the itinerary tables are written per tour', pages: ['c'] });
  recordAttempt(proj, 'solo', { notAttempted: 'one page' });
  const r = run(['summary', '--root', proj]); assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n'), [
    'encode-attempt solo: 0 sibling(s) · 0 encoded · 0 slot-rendered · 0 hand-authored · 0 not-attempted (not-attempted)',
    'encode-attempt tours: 5 sibling(s) · 1 encoded · 1 slot-rendered · 2 hand-authored · 1 not-attempted (hand-authored; 1 hand-authored without a record: e)',
    'encode: 0 encoded · 2 A′ (0 no-roundtrip, 1 not-attempted, 1 hand-authored)',
  ]);
  const j = JSON.parse(run(['summary', '--root', proj, '--json']).out);
  assert.deepEqual(j.perTemplate.find((t) => t.template === 'tours'), { template: 'tours', verdict: 'hand-authored', siblings: 5, encoded: 1, slotRendered: 1, handAuthored: 2, notAttempted: 1, unrecorded: ['e'] });
});

check('after delivery (every page migrated) the siblings still count: a migrate sidecar naming the template is a sibling — in summary and in the record threshold', () => {
  const proj = join(tmp, 'delivered'); const put = (rel, data) => { const f = join(proj, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`); };
  put('stardust/state.json', { pages: ['tours', 'a', 'b'].map((x) => ({ slug: x, url: `https://example.test/${x}/`, status: 'migrated', type: 'tour' })) });
  put('stardust/migrated/tours/_meta.json', { slug: 'tours', template: null, renderBranch: 'A' });
  put('stardust/migrated/tours/a/_meta.json', { slug: 'a', template: 'tours', renderBranch: "A'", slotSource: 'page-json' });
  put('stardust/migrated/tours/b/_meta.json', { slug: 'b', template: 'tours', fidelityTier: 'sibling', encode: { output: { path: 'x' } }, audit: { encode: { status: 'clean' } } });
  const state = JSON.parse(readFileSync(join(proj, 'stardust/state.json'), 'utf8'));
  assert.deepEqual(siblingsOf(state, 'tours'), [], 'the state alone no longer tells them apart');
  const r = run(['record', '--template', 'tours', '--root', proj, '--encoder', FAKE]); assert.equal(r.status, 2);
  assert.match(r.err, /^encode-attempt tours: refused not-attempted — 2 sibling\(s\) \(a, b\) and no map at /);
  recordAttempt(proj, 'tours', { reason: 'delivered before the map rule' });
  assert.match(run(['summary', '--root', proj]).out, /^encode-attempt tours: 2 sibling\(s\) · 1 encoded · 1 slot-rendered · 0 hand-authored · 0 not-attempted \(not-attempted\)$/m);
});

// ---- determinism ----------------------------------------------------------------------------------
console.log('determinism');
check('two records of the same attempt → the same bytes but at / writtenAt; fixed key order; no tmp file left', () => {
  const strip = (s) => s.replace(/"(writtenAt|at)": "[^"]*"/g, '"$1": "-"');
  rec('diff'); const a = read(P(REC('diff')));
  rec('diff'); const b = read(P(REC('diff')));
  assert.equal(strip(a), strip(b)); assert.ok(a.endsWith('}\n'));
  assert.deepEqual(Object.keys(JSON.parse(a)), ['_provenance', 'template', 'verdict', 'roundtrip', 'lint', 'reason', 'pages', 'at']);
  assert.equal(JSON.parse(a).pages, null, 'pages: the hand-authored siblings only');
  assert.deepEqual(Object.keys(JSON.parse(a)._provenance), ['writtenBy', 'writtenAt']);
  assert.deepEqual(readdirSync(join(ROOT, 'stardust/migrate/encode')).filter((f) => !f.endsWith('.json')), []);
});

// ---- encoder first: a template with ≥ 2 siblings gets a map, or a reason why not ---------------------------
console.log('encoder first');
const STATE_FILE = join(ROOT, 'stardust', 'state.json');
const pg = (slug, status, type, extra = {}) => ({ slug, url: `https://example.test/${slug}/`, status, type, ...extra });
writeFileSync(STATE_FILE, `${JSON.stringify({ pages: [
  pg('guides', 'approved', 'guide'), pg('guide-a', 'directed', 'guide'), pg('guide-b', 'directed', 'guide'), pg('guide-c', 'extracted', 'guide', { representative: 'guides' }),
  pg('notes', 'approved', 'note'), pg('note-a', 'directed', 'note'),
  pg('tours', 'approved', 'tour'), pg('tour-a', 'directed', 'listing', { representative: 'tours' }), pg('tour-b', 'directed', 'listing', { representative: 'tours' }),
  pg('listing', 'approved', 'listing'), pg('listing-a', 'directed', 'listing'),
] }, null, 2)}\n`);
check('siblingsOf: representative links, else the directed pages of the template\'s type without one (the template the single approved page of its type)', () => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  assert.deepEqual(siblingsOf(state, 'guides'), ['guide-a', 'guide-b', 'guide-c']);
  assert.deepEqual(siblingsOf(state, 'notes'), ['note-a']);
  assert.deepEqual(siblingsOf(state, 'tours'), ['tour-a', 'tour-b'], 'a representative link wins over the type');
  assert.deepEqual(siblingsOf(state, 'listing'), ['listing-a'], 'pages linked to another archetype are not the type\'s');
  assert.deepEqual(siblingsOf(state, 'unknown'), []); assert.deepEqual(siblingsOf(null, 'guides'), []);
});
check('no map and ≥ 2 siblings → not-attempted refused: exit 2, nothing written, the line names the siblings, the C-archetype map and --reason', () => {
  const before = runs().length;
  const r = rec('guides'); assert.equal(r.status, 2); assert.equal(r.out, '');
  assert.equal(r.err, 'encode-attempt guides: refused not-attempted — 3 sibling(s) (guide-a, guide-b, guide-c) and no map at stardust/import/guides/vocabulary.json: draft the map in the C-archetype unit (migrate SKILL.md § Encoder first), then record again — or pass --reason "<why the encoder cannot serve this template>"\n');
  assert.ok(!has(P(REC('guides')))); assert.equal(runs().length, before);
  assert.throws(() => recordAttempt(ROOT, 'guides', { encoder: FAKE }), (e) => e instanceof Refusal && /^encode-attempt guides: refused not-attempted — 3 sibling\(s\)/.test(e.message));
});
check('--reason names why → recorded not-attempted, the reason first and the cause in brackets; one sibling needs no reason', () => {
  const r = rec('guides', ['--reason', 'each guide is a one-off legal text']); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt guides: not-attempted — each guide is a one-off legal text (no map at stardust/import/guides/vocabulary.json — the encoder needs the template\'s map)\n');
  assert.equal(json(P(REC('guides'))).verdict, 'not-attempted');
  const one = rec('notes'); assert.equal(one.status, 0, one.err);
  assert.equal(one.out, 'encode-attempt notes: not-attempted — no map at stardust/import/notes/vocabulary.json — the encoder needs the template\'s map\n');
  for (const t of ['guides', 'notes']) rmSync(join(ROOT, REC(t)));
});
check('the encoder-absent default with ≥ 2 siblings → refused naming the copy; --state points at another roster; with the map present the encoder runs as before', () => {
  const copy = join(tmp, 'copy', 'stardust', 'scripts', 'migrate', 'encode-attempt.mjs');
  const r = run(['record', '--template', 'tours', '--root', ROOT], copy); assert.equal(r.status, 2);
  assert.match(r.err, /^encode-attempt tours: refused not-attempted — 2 sibling\(s\) \(tour-a, tour-b\) and encode\.mjs not found beside this script: copy the migrate scripts \(encode\.mjs and encode\/\) beside encode-attempt\.mjs, then record again — or pass --reason "/);
  const alt = write('alt-state.json', JSON.stringify({ pages: [pg('tours', 'approved', 'tour')] }));
  const solo = run(['record', '--template', 'tours', '--root', ROOT, '--state', alt], copy); assert.equal(solo.status, 0, solo.err);
  assert.match(solo.out, /^encode-attempt tours: not-attempted — encode\.mjs not found beside this script\n$/);
  map('tours'); const enc = rec('tours'); assert.equal(enc.status, 0, enc.err); assert.match(enc.out, /^encode-attempt tours: no-roundtrip — /);
  rmSync(join(ROOT, 'stardust', 'import', 'tours'), { recursive: true }); rmSync(join(ROOT, REC('tours')));
});
check('usage: --reason with --not-attempted (which carries its own), an empty --reason, a --state that does not exist → exit 2, nothing written', () => {
  for (const extra of [['--not-attempted', 'x', '--reason', 'y'], ['--reason', ''], ['--reason', '  '], ['--state', join(tmp, 'nope.json')]]) {
    const r = rec('guides', extra); assert.equal(r.status, 2, `${extra.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, /^usage error: /);
  }
  assert.ok(!has(P(REC('guides'))));
});
check('--hand-authored --reason: verdict hand-authored, nothing run, pages = the template\'s siblings, the earlier run\'s roundtrip and lint kept as evidence', () => {
  map('guides'); rec('guides'); const tried = json(P(REC('guides'))); assert.equal(tried.verdict, 'no-roundtrip');
  const before = runs().length;
  const r = run(['record', '--template', 'guides', '--root', ROOT, '--hand-authored', '--reason', 'the map cannot express the per-page legal tables']); assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'encode-attempt guides: hand-authored — the map cannot express the per-page legal tables (3 page(s): guide-a, guide-b, guide-c)\n');
  const j = json(P(REC('guides')));
  assert.equal(j.verdict, 'hand-authored'); assert.equal(j.reason, 'the map cannot express the per-page legal tables');
  assert.deepEqual(j.pages, ['guide-a', 'guide-b', 'guide-c']); assert.deepEqual(j.roundtrip, tried.roundtrip); assert.deepEqual(j.lint, tried.lint);
  assert.equal(runs().length, before, 'nothing run');
  const some = run(['record', '--template', 'guides', '--root', ROOT, '--hand-authored', '--reason', 'two exception pages', '--pages', 'guide-c,guide-a']); assert.equal(some.status, 0, some.err);
  assert.deepEqual(json(P(REC('guides'))).pages, ['guide-a', 'guide-c']);
  assert.equal(run(['check', '--template', 'guides', '--root', ROOT]).status, 0, 'a hand-authored record passes check (render\'s A′ gate)');
  const s = run(['summary', '--root', ROOT, '--json']); const sj = JSON.parse(s.out);
  assert.equal(sj.handAuthored, 1); assert.deepEqual(sj.templates.find((t) => t.template === 'guides'), { template: 'guides', verdict: 'hand-authored', reason: 'two exception pages', pages: ['guide-a', 'guide-c'] });
  assert.match(run(['summary', '--root', ROOT]).out, /, 1 hand-authored\)\n$/);
  rmSync(join(ROOT, 'stardust', 'import', 'guides'), { recursive: true }); rmSync(join(ROOT, REC('guides')));
});
check('usage: --hand-authored needs --reason and runs nothing (no --encoder, no --not-attempted); --pages needs --hand-authored → exit 2, nothing written', () => {
  for (const extra of [['--hand-authored'], ['--hand-authored', '--reason', 'x', '--encoder', FAKE], ['--hand-authored', '--reason', 'x', '--not-attempted', 'y'], ['--pages', 'guide-a', '--reason', 'x']]) {
    const r = run(['record', '--template', 'guides', '--root', ROOT, ...extra]); assert.equal(r.status, 2, `${extra.join(' ')}: ${r.out}${r.err}`); assert.match(r.err, /^usage error: /);
  }
  assert.ok(!has(P(REC('guides'))));
  assert.throws(() => recordAttempt(ROOT, 'guides', { handAuthored: true }), (e) => e instanceof UsageError && /--hand-authored needs --reason/.test(e.message));
});
rmSync(STATE_FILE);

// ---- the library (Task 9's migrate.mjs hooks) ---------------------------------------------------
console.log('library');
check('readAttempt / requireEncodeAttempt: a valid record → the record / null; none or malformed → null / the refusal line', () => {
  assert.equal(readAttempt(ROOT, 'good').verdict, 'encoded');
  assert.equal(requireEncodeAttempt(ROOT, 'good'), null);
  for (const t of ['missing', 'broken']) {
    assert.equal(readAttempt(ROOT, t), null);
    assert.equal(requireEncodeAttempt(ROOT, t), `encode-attempt ${t}: no attempt record — run: ${CMD} ${t}`);
  }
  assert.equal(readAttempt(ROOT, '../good'), null, 'an invalid name has no record');
  assert.match(requireEncodeAttempt(ROOT, '../good'), /no attempt record/);
});
check('recordAttempt returns the record it wrote; timeoutMs stops a slow encoder → no-roundtrip naming the timeout', () => {
  const r = recordAttempt(ROOT, 'good', { encoder: FAKE });
  assert.deepEqual(r, json(P(REC('good')))); assert.equal(r.verdict, 'encoded');
  const s = recordAttempt(ROOT, 'slow', { encoder: FAKE, timeoutMs: 500 });
  assert.equal(s.verdict, 'no-roundtrip'); assert.match(s.reason, /timed out/); assert.equal(s.roundtrip.exit, null);
  const o = recordAttempt(ROOT, 'owner2', { notAttempted: 'owner decision' });
  assert.equal(o.verdict, 'not-attempted'); assert.equal(o.reason, 'owner decision');
  assert.throws(() => recordAttempt(ROOT, 'owner3', { notAttempted: '' }), /not-attempted/);
  rmSync(join(ROOT, REC('slow'))); rmSync(join(ROOT, REC('owner2')));
});
check('summaryLine counts records; a missing record (null) is named, not counted as A′', () => {
  const recs = ['good', 'diff', 'nogated', 'nomap', 'owner'].map((t) => readAttempt(ROOT, t));
  assert.equal(summaryLine(recs), 'encode: 1 encoded · 4 A′ (2 no-roundtrip, 2 not-attempted, 0 hand-authored)');
  assert.equal(summaryLine([]), 'encode: 0 encoded · 0 A′ (0 no-roundtrip, 0 not-attempted, 0 hand-authored)');
  assert.equal(summaryLine([readAttempt(ROOT, 'good'), null]), 'encode: 1 encoded · 0 A′ (0 no-roundtrip, 0 not-attempted, 0 hand-authored) · 1 without a record');
  assert.equal(summaryLine([readAttempt(ROOT, 'good'), { template: 'h', verdict: 'hand-authored' }]), 'encode: 1 encoded · 1 A′ (0 no-roundtrip, 0 not-attempted, 1 hand-authored)');
});

// ---- done -----------------------------------------------------------------------------------
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed, ${passed} passed` : `\nall checks passed (${passed})`);
process.exitCode = failed ? 1 : 0;
