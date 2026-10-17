#!/usr/bin/env node
// skills/stardust/scripts/test/progress.test.mjs — the progress.mjs contract: the unit transitions
// (start / resume / done / failed, --again), the per-ledger map and --kind vocabulary, --set (dotted
// key inside the entry, JSON or string value, __proto__ / constructor / prototype refused), the
// shape refusals (not JSON, not an object, a non-object map or entry, a replica file holding one
// archetype's bare record), the replica ledger's other top-level keys kept as they were, the one
// status line, show, both script layouts, and parallel writers losing no entry. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUnit, formatLine, parseArgs, parseSetValue, setPath } from '../progress.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'progress.mjs');
const LOCK_LIB = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'file-lock.mjs');
const root = mkdtempSync(join(tmpdir(), 'progress-test-'));
let seq = 0;
const project = () => { seq += 1; const d = join(root, `p${seq}`); mkdirSync(d); return d; };
const runWith = (script, cwd, args) => { const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const runIn = (cwd, ...args) => runWith(SCRIPT, cwd, args);
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8'));
const put = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`); };
const oneLine = (s) => { assert.equal(s.split('\n').filter(Boolean).length, 1, `one line expected, got: ${s}`); return s.trimEnd(); };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROLLOUT = 'stardust/rollout/progress.json';
const MIGRATE = 'stardust/migrate/progress.json';
const REPLICA = 'stardust/replica/progress.json';
const T0 = '2026-01-02T03:04:05Z';
const T1 = '2026-01-02T04:00:00Z';
const opts = (o) => ({ ledger: 'rollout', file: ROLLOUT, fields: {}, sets: [], again: false, ...o });

// ---- pure helpers -------------------------------------------------------------------------------
check('parseSetValue: JSON when it parses, else the string as given', () => {
  assert.equal(parseSetValue('12'), 12);
  assert.equal(parseSetValue('true'), true);
  assert.equal(parseSetValue('null'), null);
  assert.equal(parseSetValue('"x y"'), 'x y');
  assert.deepEqual(parseSetValue('{"archetype":1.2,"sibling":[0.4]}'), { archetype: 1.2, sibling: [0.4] });
  assert.equal(parseSetValue('3 bands over 2%'), '3 bands over 2%');
  assert.equal(parseSetValue(''), '');
});
check('setPath: creates the missing objects on the dotted path, keeps their other keys, refuses a non-object on the way', () => {
  const e = { gates: { 360: { archetype: 0.9 } } };
  setPath(e, ['gates', '1440', 'archetype'], 1.2);
  setPath(e, ['gates', 'crop'], 'ok');
  assert.deepEqual(e, { gates: { 360: { archetype: 0.9 }, 1440: { archetype: 1.2 }, crop: 'ok' } });
  assert.throws(() => setPath({ gates: 3 }, ['gates', '1440'], 1), /gates is not an object/);
  assert.throws(() => setPath({ gates: [] }, ['gates', '0'], 1), /gates is not an object/);
});
check('parseArgs: unit and show forms, defaults, every value flag', () => {
  const a = parseArgs(['unit', 'start', 'c1', '--kind', 'cluster', '--pages', '3', '--blocks', '2', '--templates', 'article, list,', '--verdict', 'pass\n 3/3', '--set', 'gates.1440={"a":1}', '--set', 'gates.crop=ok']);
  assert.equal(a.cmd, 'unit'); assert.equal(a.event, 'start'); assert.equal(a.name, 'c1'); assert.equal(a.ledger, 'rollout'); assert.equal(a.file, null);
  assert.deepEqual(a.fields, { kind: 'cluster', pages: 3, blocks: 2, templates: ['article', 'list'], verdict: 'pass 3/3' });
  assert.deepEqual(a.sets, [{ path: ['gates', '1440'], value: { a: 1 } }, { path: ['gates', 'crop'], value: 'ok' }]);
  assert.equal(a.again, false); assert.equal(a.json, false);
  const s = parseArgs(['show', '--ledger', 'replica', '--file', 'x.json', '--json']);
  assert.equal(s.cmd, 'show'); assert.equal(s.name, null); assert.equal(s.ledger, 'replica'); assert.equal(s.file, 'x.json'); assert.equal(s.json, true);
  assert.equal(parseArgs(['show', 'home']).name, 'home');
  assert.equal(parseArgs(['unit', 'start', 'c1', '--again']).again, true);
});
check('parseArgs: usage errors (exit 2) — names, events, kinds per ledger, numbers, a swallowed flag, misplaced flags', () => {
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad([], /usage/i);
  bad(['unit', 'start'], /<name>/);
  bad(['unit', 'begin', 'c1'], /start\|done\|failed/);
  bad(['unit', 'start', 'c 1'], /must match/);
  bad(['unit', 'start', 'a/b'], /must match/);
  bad(['unit', 'start', '__proto__'], /reserved/);
  bad(['unit', 'start', 'c1', 'extra'], /unexpected/);
  bad(['frob'], /unknown command/);
  bad(['unit', 'start', 'c1', '--ledger', 'deploy'], /rollout\|migrate\|replica/);
  bad(['unit', 'start', 'c1', '--kind', 'render'], /not a rollout kind \(foundation\|archetype\|cluster\|final\)/);
  bad(['unit', 'start', 'c1', '--ledger', 'migrate', '--kind', 'cluster'], /not a migrate kind \(plan\|render\|assets\|report\)/);
  bad(['unit', 'start', 'home', '--ledger', 'replica', '--kind', 'archetype'], /replica records take no --kind.*--set pageType=/);
  bad(['unit', 'start', 'c1', '--pages', '-1'], /--pages needs an integer ≥ 0/);
  bad(['unit', 'start', 'c1', '--pages', '2.5'], /--pages needs an integer ≥ 0/);
  bad(['unit', 'start', 'c1', '--blocks', 'x'], /--blocks needs an integer ≥ 0/);
  bad(['unit', 'start', 'c1', '--verdict', '  '], /--verdict needs/);
  bad(['unit', 'start', 'c1', '--verdict', '--json'], /--verdict needs a value \(got --json, which is a flag\)/);
  bad(['unit', 'start', 'c1', '--pages'], /--pages needs a value/);
  bad(['unit', 'start', 'c1', '--kind', 'cluster', '--kind', 'final'], /--kind given twice/);
  bad(['unit', 'start', 'c1', '--frob'], /unknown option --frob/);
  bad(['unit', 'done', 'c1', '--again'], /--again applies to unit start only/);
  bad(['show', '--kind', 'cluster'], /--kind applies to unit only/);
  bad(['show', 'a', 'b'], /unexpected/);
});
check('parseArgs: --set needs key=value; __proto__ / constructor / prototype refused anywhere on the path; the command\'s own fields refused', () => {
  const bad = (set, re) => assert.throws(() => parseArgs(['unit', 'start', 'c1', '--set', set]), (e) => e.code === 2 && re.test(e.message), `${set} → ${re}`);
  bad('gates', /--set needs <key>=<value>/);
  bad('=1', /--set needs <key>=<value>/);
  bad('gates..x=1', /empty key segment/);
  bad('__proto__.polluted=1', /"__proto__" is not a settable key/);
  bad('gates.__proto__=1', /"__proto__" is not a settable key/);
  bad('constructor.prototype.x=1', /"constructor" is not a settable key/);
  bad('gates.prototype=1', /"prototype" is not a settable key/);
  bad('status=done', /status is set by the command itself/);
  bad('startedAt=x', /startedAt is set by the command itself/);
  bad('kind=final', /use --kind/);
  bad('pages=4', /use --pages/);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(parseArgs(['unit', 'start', 'c1', '--set', 'note=a=b']).sets, [{ path: ['note'], value: 'a=b' }]);
});
check('applyUnit: start / resume / done / failed / --again transitions, field order, flags set their fields', () => {
  const doc = {};
  const s = applyUnit(doc, opts({ event: 'start', name: 'c1', fields: { kind: 'cluster', pages: 3 } }), T0);
  assert.equal(s.resumed, false);
  assert.deepEqual(doc, { units: { c1: { status: 'running', kind: 'cluster', pages: 3, startedAt: T0 } } });
  const r = applyUnit(doc, opts({ event: 'start', name: 'c1' }), T1);
  assert.equal(r.resumed, true); assert.equal(doc.units.c1.startedAt, T0, 'a resume keeps startedAt');
  const d = applyUnit(doc, opts({ event: 'done', name: 'c1', fields: { verdict: 'pass', templates: ['a'] }, sets: [{ path: ['gates', '1440'], value: { archetype: 1 } }] }), T1);
  assert.deepEqual(Object.keys(d.entry), ['status', 'kind', 'templates', 'pages', 'gates', 'startedAt', 'endedAt', 'verdict']);
  assert.equal(d.entry.status, 'done'); assert.equal(d.entry.endedAt, T1);
  assert.throws(() => applyUnit(doc, opts({ event: 'start', name: 'c1' }), T1), (e) => e.code === 2 && e.message === 'unit c1 is done — pass --again to run it again');
  const again = applyUnit(doc, opts({ event: 'start', name: 'c1', again: true }), T1);
  assert.equal(again.resumed, false); assert.equal(again.entry.status, 'running'); assert.equal(again.entry.startedAt, T1); assert.ok(!('endedAt' in again.entry));
  applyUnit(doc, opts({ event: 'failed', name: 'c1', fields: { verdict: 'fail: 2 bands' } }), T1);
  assert.equal(doc.units.c1.status, 'failed');
  const re = applyUnit(doc, opts({ event: 'start', name: 'c1' }), '2026-01-03T00:00:00Z');
  assert.equal(re.resumed, false); assert.equal(re.entry.startedAt, '2026-01-03T00:00:00Z'); assert.ok(!('endedAt' in re.entry), 'a restart after failed drops endedAt');
  assert.throws(() => applyUnit(doc, opts({ event: 'done', name: 'c9' }), T1), (e) => e.code === 2 && e.message === `no unit c9 in ${ROLLOUT} — progress.mjs unit start c9 first`);
  assert.throws(() => applyUnit({ units: { c1: { status: 'blocked' } } }, opts({ event: 'start', name: 'c1' }), T1), /status "blocked" is not one of pending\|running\|done\|failed/);
});
check('applyUnit: shape refusals (not an object, map, entry, a replica bare record)', () => {
  const bad = (doc, o, re) => assert.throws(() => applyUnit(doc, opts(o), T0), (e) => e.code === 2 && re.test(e.message), String(re));
  bad([], { event: 'start', name: 'c1' }, /is not a JSON object/);
  bad({ units: [] }, { event: 'start', name: 'c1' }, /units is not an object/);
  bad({ units: { c1: 'done' } }, { event: 'done', name: 'c1' }, /units\.c1 is not an object/);
  bad({ types: null }, { ledger: 'replica', file: REPLICA, event: 'start', name: 'home' }, /types is not an object/);
  bad({ archetype: 'home', breakpoints: {} }, { ledger: 'replica', file: REPLICA, event: 'start', name: 'home' }, /one archetype's record at the top level \(archetype, breakpoints\).*gate-evidence\.mjs wraps.*types\.<archetype>.*source-fidelity-gate\.md § Residual logging format/);
  bad({ breakpoints: {} }, { ledger: 'replica', file: REPLICA, event: 'start', name: 'home' }, /one archetype's record at the top level \(breakpoints\)/);
});
check('formatLine: deterministic field order, unset fields omitted, (resumed), one line', () => {
  const e = { verdict: 'pass 3/3\nall widths', endedAt: T1, startedAt: T0, templates: ['article', 'list'], blocks: 2, pages: 3, kind: 'cluster', status: 'done', gates: { 1440: {} } };
  assert.equal(formatLine('rollout', 'c1', e), `progress rollout c1: done kind=cluster pages=3 blocks=2 templates=article,list startedAt=${T0} endedAt=${T1} verdict=pass 3/3 all widths`);
  assert.equal(formatLine('migrate', 'm1', { status: 'running', startedAt: T0 }, { resumed: true }), `progress migrate m1: running (resumed) startedAt=${T0}`);
  assert.equal(formatLine('replica', 'home', { pageType: 'landing' }), 'progress replica home: -');
});

// ---- the CLI -----------------------------------------------------------------------------------
check('--help: exit 0, usage on stdout, nothing written (also before a bad flag)', () => {
  const d = project();
  const h = runIn(d, '--help');
  assert.equal(h.code, 0); assert.match(h.out, /Usage:/); assert.match(h.out, /progress\.mjs unit <start\|done\|failed> <name>/); assert.match(h.out, /Exit codes: 0/);
  assert.equal(runIn(d, 'unit', 'start', 'c1', '--frob', '-h').code, 0);
  assert.deepEqual(readdirSync(d), []);
});
check('rollout: start → done round trip; the file is created with its map; one status line per write', () => {
  const d = project();
  const s = runIn(d, 'unit', 'start', 'cluster-article', '--kind', 'cluster', '--templates', 'article', '--pages', '12');
  assert.equal(s.code, 0, s.err);
  assert.match(oneLine(s.out), /^progress rollout cluster-article: running kind=cluster pages=12 templates=article startedAt=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const f = readJ(join(d, ROLLOUT));
  assert.deepEqual(Object.keys(f), ['units']);
  const u = f.units['cluster-article'];
  assert.match(u.startedAt, ISO);
  assert.deepEqual(u, { status: 'running', kind: 'cluster', templates: ['article'], pages: 12, startedAt: u.startedAt });
  const e = runIn(d, 'unit', 'done', 'cluster-article', '--blocks', '2', '--verdict', 'pass 12/12 at 1440 and 360', '--set', 'gates.1440={"archetype":1.3,"sibling":2.1}', '--set', 'gates.crop=no bands');
  assert.equal(e.code, 0, e.err);
  const v = readJ(join(d, ROLLOUT)).units['cluster-article'];
  assert.equal(v.status, 'done'); assert.match(v.endedAt, ISO); assert.equal(v.startedAt, u.startedAt);
  assert.deepEqual(v.gates, { 1440: { archetype: 1.3, sibling: 2.1 }, crop: 'no bands' });
  assert.equal(oneLine(e.out), `progress rollout cluster-article: done kind=cluster pages=12 blocks=2 templates=article startedAt=${v.startedAt} endedAt=${v.endedAt} verdict=pass 12/12 at 1440 and 360`);
  assert.equal(e.err, '');
  assert.deepEqual(readdirSync(join(d, 'stardust', 'rollout')), ['progress.json'], 'no lock dir or tmp file left');
});
check('migrate: start → failed → start → done on stardust/migrate/progress.json; --json prints the entry', () => {
  const d = project();
  assert.equal(runIn(d, 'unit', 'start', 'article', '--ledger', 'migrate', '--kind', 'render', '--templates', 'article').code, 0);
  const f = runIn(d, 'unit', 'failed', 'article', '--ledger', 'migrate', '--verdict', 'rendered 3, refused 1');
  assert.equal(f.code, 0, f.err); assert.match(f.out, /^progress migrate article: failed kind=render templates=article startedAt=\S+ endedAt=\S+ verdict=rendered 3, refused 1\n$/);
  assert.equal(runIn(d, 'unit', 'start', 'article', '--ledger', 'migrate').code, 0);
  const j = runIn(d, 'unit', 'done', 'article', '--ledger', 'migrate', '--pages', '4', '--verdict', 'rendered 4, unchanged 0, refused 0, passthrough 0', '--json');
  assert.equal(j.code, 0, j.err);
  const entry = JSON.parse(oneLine(j.out));
  assert.deepEqual(entry, readJ(join(d, MIGRATE)).units.article);
  assert.equal(entry.status, 'done'); assert.equal(entry.pages, 4);
  assert.ok(!existsSync(join(d, ROLLOUT)), 'the rollout ledger is not touched');
});
check('replica: start → done under types.<archetype>, --set pageType; siblings / migrate / _provenance and other types kept as they were', () => {
  const d = project();
  const others = {
    _provenance: { writtenBy: 'gate-evidence.mjs', writtenAt: '2026-01-01T00:00:00Z' },
    types: { product: { pageType: 'product', archetype: 'product', breakpoints: { 1440: { iterations: 2, result: { pixelPct: 1.31, pass: true } } } } },
    siblings: { rows: [{ slug: 'a', missing: [] }], n: 1.0 },
    migrate: { at: '2026-01-01T00:00:00Z', pages: 9, gates: { 'pixel-gate-1440': 9 } },
  };
  put(join(d, REPLICA), others);
  const s = runIn(d, 'unit', 'start', 'home', '--ledger', 'replica', '--set', 'pageType=landing', '--set', 'archetype=home');
  assert.equal(s.code, 0, s.err); assert.match(oneLine(s.out), /^progress replica home: running startedAt=\S+$/);
  const e = runIn(d, 'unit', 'done', 'home', '--ledger', 'replica', '--verdict', 'gate passed at 1440 and 360', '--set', 'breakpoints.1440.iterations=3');
  assert.equal(e.code, 0, e.err);
  const f = readJ(join(d, REPLICA));
  assert.deepEqual(Object.keys(f), ['_provenance', 'types', 'siblings', 'migrate']);
  for (const k of ['_provenance', 'siblings', 'migrate']) assert.deepEqual(f[k], others[k], k);
  assert.deepEqual(f.types.product, others.types.product);
  const h = f.types.home;
  assert.equal(h.status, 'done'); assert.equal(h.pageType, 'landing'); assert.equal(h.archetype, 'home'); assert.deepEqual(h.breakpoints, { 1440: { iterations: 3 } });
  assert.equal(h.verdict, 'gate passed at 1440 and 360'); assert.match(h.startedAt, ISO); assert.match(h.endedAt, ISO);
  const fresh = project();
  assert.equal(runIn(fresh, 'unit', 'start', 'home', '--ledger', 'replica').code, 0);
  assert.deepEqual(Object.keys(readJ(join(fresh, REPLICA))), ['types'], 'an absent replica ledger is created with its types map');
});
check('resume: start on a running unit keeps startedAt and says (resumed); start after failed is a fresh start', () => {
  const d = project();
  put(join(d, ROLLOUT), { units: { c1: { status: 'running', kind: 'cluster', startedAt: T0 }, c2: { status: 'failed', startedAt: T0, endedAt: T1, verdict: 'fail' } } });
  const r = runIn(d, 'unit', 'start', 'c1');
  assert.equal(r.code, 0, r.err); assert.equal(oneLine(r.out), `progress rollout c1: running (resumed) kind=cluster startedAt=${T0}`);
  assert.equal(readJ(join(d, ROLLOUT)).units.c1.startedAt, T0);
  const f = runIn(d, 'unit', 'start', 'c2');
  assert.equal(f.code, 0, f.err);
  const c2 = readJ(join(d, ROLLOUT)).units.c2;
  assert.equal(c2.status, 'running'); assert.notEqual(c2.startedAt, T0); assert.ok(!('endedAt' in c2)); assert.doesNotMatch(f.out, /resumed/);
});
check('done unit: start refused without --again (exit 2, file untouched); --again starts it fresh', () => {
  const d = project();
  const file = join(d, ROLLOUT);
  put(file, { units: { c1: { status: 'done', kind: 'cluster', startedAt: T0, endedAt: T1, verdict: 'pass' } } });
  const before = readFileSync(file, 'utf8');
  const r = runIn(d, 'unit', 'start', 'c1');
  assert.equal(r.code, 2); assert.equal(r.out, ''); assert.equal(r.err, 'progress: unit c1 is done — pass --again to run it again\n');
  assert.equal(readFileSync(file, 'utf8'), before);
  const a = runIn(d, 'unit', 'start', 'c1', '--again');
  assert.equal(a.code, 0, a.err);
  const c1 = readJ(file).units.c1;
  assert.equal(c1.status, 'running'); assert.notEqual(c1.startedAt, T0); assert.ok(!('endedAt' in c1));
});
check('done / failed on a unit that was never started: exit 2, one stderr line, nothing written (no file created)', () => {
  const d = project();
  const r = runIn(d, 'unit', 'done', 'c1');
  assert.equal(r.code, 2); assert.equal(r.err, `progress: no unit c1 in ${ROLLOUT} — progress.mjs unit start c1 first\n`);
  assert.deepEqual(readdirSync(d), [], 'no file and no directory created');
  put(join(d, ROLLOUT), { units: { c2: { status: 'running', startedAt: T0 } } });
  const before = readFileSync(join(d, ROLLOUT), 'utf8');
  const f = runIn(d, 'unit', 'failed', 'c1');
  assert.equal(f.code, 2); assert.match(f.err, /^progress: no unit c1 in stardust\/rollout\/progress\.json — progress\.mjs unit start c1 first\n$/);
  assert.equal(readFileSync(join(d, ROLLOUT), 'utf8'), before);
});
check('shape refusals on disk: a bare archetype record, a non-object map or entry, not JSON, an array — exit 2, one stderr line, file untouched', () => {
  const cases = [
    [REPLICA, { archetype: 'home', pageType: 'landing', breakpoints: { 1440: {} } }, ['--ledger', 'replica'], /^progress: stardust\/replica\/progress\.json is one archetype's record at the top level \(archetype, breakpoints\).*gate-evidence\.mjs.*source-fidelity-gate\.md § Residual logging format/],
    [ROLLOUT, { units: [] }, [], /^progress: stardust\/rollout\/progress\.json: units is not an object/],
    [ROLLOUT, { units: 'c1' }, [], /units is not an object/],
    [MIGRATE, { units: { c1: [] } }, ['--ledger', 'migrate'], /units\.c1 is not an object/],
    [REPLICA, { types: [] }, ['--ledger', 'replica'], /types is not an object/],
    [ROLLOUT, '{ "units": { ', [], /^progress: stardust\/rollout\/progress\.json is not JSON/],
    [ROLLOUT, '[1,2]', [], /is not a JSON object/],
  ];
  for (const [rel, content, extra, re] of cases) {
    const d = project();
    put(join(d, rel), content);
    const before = readFileSync(join(d, rel), 'utf8');
    const r = runIn(d, 'unit', 'start', 'c1', ...extra);
    assert.equal(r.code, 2, `${rel} ${JSON.stringify(content)}: ${r.err}`);
    assert.match(r.err, re); assert.equal(r.err.split('\n').filter(Boolean).length, 1); assert.equal(r.out, '');
    assert.equal(readFileSync(join(d, rel), 'utf8'), before);
    assert.deepEqual(readdirSync(dirname(join(d, rel))), ['progress.json'], 'no lock dir left');
  }
});
check('--set via the CLI: dotted JSON and string values; __proto__ refused with nothing written', () => {
  const d = project();
  assert.equal(runIn(d, 'unit', 'start', 'c1', '--set', 'gates.360={"archetype":0.8}', '--set', 'gates.chrome=0 deltas', '--set', 'gates.n=4').code, 0);
  assert.deepEqual(readJ(join(d, ROLLOUT)).units.c1.gates, { 360: { archetype: 0.8 }, chrome: '0 deltas', n: 4 });
  const before = readFileSync(join(d, ROLLOUT), 'utf8');
  for (const s of ['__proto__.polluted=1', 'gates.__proto__={"x":1}', 'constructor.prototype.x=1']) {
    const r = runIn(d, 'unit', 'start', 'c1', '--set', s);
    assert.equal(r.code, 2, s); assert.match(r.err, /is not a settable key/);
  }
  assert.equal(readFileSync(join(d, ROLLOUT), 'utf8'), before);
});
check('--kind per ledger via the CLI: wrong vocabulary and any replica --kind exit 2, nothing written', () => {
  const d = project();
  assert.equal(runIn(d, 'unit', 'start', 'c1', '--kind', 'render').code, 2);
  assert.equal(runIn(d, 'unit', 'start', 'm1', '--ledger', 'migrate', '--kind', 'final').code, 2);
  const r = runIn(d, 'unit', 'start', 'home', '--ledger', 'replica', '--kind', 'archetype');
  assert.equal(r.code, 2); assert.match(r.err, /--set pageType=/);
  assert.deepEqual(readdirSync(d), []);
  for (const k of ['foundation', 'archetype', 'cluster', 'final']) assert.equal(runIn(d, 'unit', 'start', `r-${k}`, '--kind', k).code, 0, k);
  for (const k of ['plan', 'render', 'assets', 'report']) assert.equal(runIn(d, 'unit', 'start', `m-${k}`, '--ledger', 'migrate', '--kind', k).code, 0, k);
});
check('--file overrides the path; the map follows --ledger', () => {
  const d = project();
  assert.equal(runIn(d, 'unit', 'start', 'home', '--ledger', 'replica', '--file', 'elsewhere/p.json').code, 0);
  assert.deepEqual(Object.keys(readJ(join(d, 'elsewhere', 'p.json'))), ['types']);
  assert.ok(!existsSync(join(d, 'stardust')));
});
check('show: one line per entry sorted by name, the named one, --json; a missing name exits 2; show writes nothing', () => {
  const d = project();
  put(join(d, ROLLOUT), { units: { zeta: { status: 'pending', kind: 'final' }, alpha: { status: 'done', kind: 'foundation', startedAt: T0, endedAt: T1, verdict: 'ok' } } });
  const before = readFileSync(join(d, ROLLOUT), 'utf8');
  const s = runIn(d, 'show');
  assert.equal(s.code, 0, s.err);
  assert.equal(s.out, `progress rollout alpha: done kind=foundation startedAt=${T0} endedAt=${T1} verdict=ok\nprogress rollout zeta: pending kind=final\n`);
  assert.equal(runIn(d, 'show', 'zeta').out, 'progress rollout zeta: pending kind=final\n');
  assert.deepEqual(JSON.parse(runIn(d, 'show', 'alpha', '--json').out), { status: 'done', kind: 'foundation', startedAt: T0, endedAt: T1, verdict: 'ok' });
  assert.deepEqual(Object.keys(JSON.parse(runIn(d, 'show', '--json').out)), ['alpha', 'zeta']);
  const m = runIn(d, 'show', 'beta');
  assert.equal(m.code, 2); assert.match(m.err, /no unit beta in stardust\/rollout\/progress\.json/);
  assert.equal(readFileSync(join(d, ROLLOUT), 'utf8'), before);
  const empty = project();
  const n = runIn(empty, 'show', '--ledger', 'migrate');
  assert.equal(n.code, 0); assert.equal(n.out, ''); assert.match(n.err, /no stardust\/migrate\/progress\.json/);
  assert.equal(runIn(empty, 'show', 'c1').code, 2);
  assert.deepEqual(readdirSync(empty), []);
});
check('layouts: the project copy (stardust/scripts/stardust + ../deploy/file-lock.mjs) works; no file-lock.mjs → exit 2 naming both paths, nothing written', () => {
  const d = project();
  const copy = join(d, 'stardust', 'scripts', 'stardust', 'progress.mjs');
  mkdirSync(dirname(copy), { recursive: true }); mkdirSync(join(d, 'stardust', 'scripts', 'deploy'));
  copyFileSync(SCRIPT, copy); copyFileSync(LOCK_LIB, join(d, 'stardust', 'scripts', 'deploy', 'file-lock.mjs'));
  const ok = runWith(copy, d, ['unit', 'start', 'c1', '--kind', 'foundation']);
  assert.equal(ok.code, 0, ok.err); assert.equal(readJ(join(d, ROLLOUT)).units.c1.kind, 'foundation');
  const lone = project();
  const bare = join(lone, 'bin', 'progress.mjs');
  mkdirSync(dirname(bare)); copyFileSync(SCRIPT, bare);
  assert.equal(runWith(bare, lone, ['--help']).code, 0, '--help answers without the lock library');
  const r = runWith(bare, lone, ['unit', 'start', 'c1']);
  assert.equal(r.code, 2); assert.match(r.err, /file-lock\.mjs not found.*deploy\/scripts\/file-lock\.mjs.*deploy\/file-lock\.mjs/);
  assert.deepEqual(readdirSync(lone), ['bin']);
});

// ---- parallel writers --------------------------------------------------------------------------
// Two writers, ten starts each on distinct names, all launched at once: the lock and the re-read
// inside it keep every entry.
const par = project();
const starts = [];
for (const w of ['a', 'b']) for (let i = 0; i < 10; i += 1) {
  starts.push(new Promise((res) => {
    const c = spawn(process.execPath, [SCRIPT, 'unit', 'start', `${w}${i}`, '--kind', 'cluster'], { cwd: par, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => { err += b; });
    c.on('close', (code) => res({ code, err }));
  }));
}
const results = await Promise.all(starts);
check('parallel: 2 × 10 concurrent starts on distinct names lose no entry, leave no lock or tmp file', () => {
  for (const r of results) assert.equal(r.code, 0, r.err);
  const units = readJ(join(par, ROLLOUT)).units;
  const want = ['a', 'b'].flatMap((w) => Array.from({ length: 10 }, (_, i) => `${w}${i}`)).sort();
  assert.deepEqual(Object.keys(units).sort(), want);
  for (const name of want) assert.equal(units[name].status, 'running', name);
  assert.deepEqual(readdirSync(join(par, 'stardust', 'rollout')), ['progress.json']);
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nprogress: all checks passed');
process.exit(failed ? 1 : 0);
