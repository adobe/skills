#!/usr/bin/env node
// skills/stardust/scripts/test/progress.test.mjs — the progress.mjs contract: the unit transitions
// (start / resume / done / failed, --again, a re-recorded end keeping endedAt), the per-ledger map and --kind vocabulary, --set (dotted
// key inside the entry, JSON or string value, __proto__ / constructor / prototype refused), the
// shape refusals (not JSON, not an object, a non-object map or entry, a replica file holding one
// archetype's bare record), the replica ledger's other top-level keys kept as they were, the one
// status line, show, show --waves (the planned units, the dependency rules, can start now), both script layouts, and parallel writers losing no entry; wait (the watched set and
// --unit, a unit ending mid-wait, --max with its notice and clamp, the pause file at the start and mid-wait,
// a watched unit gone, a ledger unreadable at the bound, --json, no file-lock.mjs needed). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyUnit, C0_ARCHETYPE, formatLine, formatWaves, parseArgs, parseSetValue, pauseState, pickWatched, setPath, waitBound, waitEndedLine,
  waitPausedLine, waitState, waitTimeoutLine, wavesView,
} from '../progress.mjs';

// A supervised session's pause file must not end these waits; the pause tests set their own.
delete process.env.STARDUST_PAUSE_FILE;
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'progress.mjs');
const LOCK_LIB = join(HERE, '..', '..', '..', 'deploy', 'scripts', 'file-lock.mjs');
const root = mkdtempSync(join(tmpdir(), 'progress-test-'));
let seq = 0;
const project = () => { seq += 1; const d = join(root, `p${seq}`); mkdirSync(d); return d; };
const runWith = (script, cwd, args, env = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t };
};
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
const running = (names) => ({ units: Object.fromEntries(names.map((n) => [n, { status: 'running', kind: 'cluster', startedAt: T0 }])) });

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
check('applyUnit: a re-recorded end keeps endedAt and applies the fields; a different prior status sets a new endedAt', () => {
  const T2 = '2026-01-02T05:00:00Z';
  const doc = { units: { c1: { status: 'done', kind: 'cluster', startedAt: T0, endedAt: T1, verdict: 'pass' } } };
  const again = applyUnit(doc, opts({ event: 'done', name: 'c1', fields: { pages: 12, verdict: 'pass 12/12' }, sets: [{ path: ['gates', '1440'], value: 1.2 }] }), T2);
  assert.deepEqual(again.entry, { status: 'done', kind: 'cluster', pages: 12, gates: { 1440: 1.2 }, startedAt: T0, endedAt: T1, verdict: 'pass 12/12' });
  const toFailed = applyUnit(doc, opts({ event: 'failed', name: 'c1' }), T2);
  assert.equal(toFailed.entry.status, 'failed'); assert.equal(toFailed.entry.endedAt, T2, 'done → failed: a new end');
  const T3 = '2026-01-02T06:00:00Z';
  assert.equal(applyUnit(doc, opts({ event: 'failed', name: 'c1', fields: { verdict: 'fail: 2 bands' } }), T3).entry.endedAt, T2, 'failed → failed keeps it');
  assert.equal(doc.units.c1.verdict, 'fail: 2 bands');
  assert.equal(applyUnit(doc, opts({ event: 'done', name: 'c1' }), T3).entry.endedAt, T3, 'failed → done: a new end');
  const noEnd = { units: { c2: { status: 'done', startedAt: T0 } } };
  assert.equal(applyUnit(noEnd, opts({ event: 'done', name: 'c2' }), T1).entry.endedAt, T1, 'done without an endedAt gets one');
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
check('parseArgs: wait — defaults, --unit repeatable (a repeat is dropped), --max; flags that belong elsewhere refused', () => {
  const w = parseArgs(['wait']);
  assert.equal(w.cmd, 'wait'); assert.deepEqual(w.units, []); assert.equal(w.max, 300); assert.equal(w.ledger, 'rollout'); assert.equal(w.json, false);
  const n = parseArgs(['wait', '--unit', 'b', '--unit', 'a', '--unit', 'b', '--max', '1.5', '--ledger', 'replica', '--file', 'x.json', '--json']);
  assert.deepEqual(n.units, ['b', 'a']); assert.equal(n.max, 1.5); assert.equal(n.ledger, 'replica'); assert.equal(n.file, 'x.json'); assert.equal(n.json, true);
  assert.equal(parseArgs(['wait', '--max', '0']).max, 0);
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad(['wait', 'c1'], /^unexpected argument\(s\) after wait: c1 — name a unit with --unit <name>$/);
  for (const v of ['-1', 'x', '1e3', '', '5s']) bad(['wait', '--max', v], new RegExp(`^--max needs a number of seconds ≥ 0, got "${v}"$`));
  bad(['wait', '--max'], /--max needs a value/);
  bad(['wait', '--max', '1', '--max', '2'], /--max given twice/);
  bad(['wait', '--unit', 'a b'], /must match/);
  bad(['wait', '--unit', '__proto__'], /reserved/);
  bad(['wait', '--unit', '--json'], /--unit needs a value \(got --json, which is a flag\)/);
  bad(['wait', '--kind', 'cluster'], /^--kind applies to unit only$/);
  bad(['wait', '--again'], /^--again applies to unit only$/);
  bad(['show', '--max', '3'], /^--max applies to wait only$/);
  bad(['show', 'c1', '--unit', 'c1'], /^--unit applies to wait only$/);
  bad(['unit', 'start', 'c1', '--max', '3'], /^--max applies to wait only$/);
});
check('wait helpers: pickWatched (every running unit, or the running ones among --unit), waitState (ended / running / gone)', () => {
  const doc = { units: { b: { status: 'running' }, a: { status: 'running' }, c: { status: 'done' }, d: { status: 'pending' }, e: {} } };
  assert.deepEqual(pickWatched(doc, 'rollout'), { watched: ['a', 'b'], skipped: [] });
  assert.deepEqual(pickWatched(doc, 'rollout', ['b', 'c', 'z', 'e']), { watched: ['b'], skipped: [{ name: 'c', status: 'done' }, { name: 'z', status: 'absent' }, { name: 'e', status: 'no status' }] });
  assert.deepEqual(pickWatched({ types: { home: { status: 'running' } }, units: { x: { status: 'running' } } }, 'replica'), { watched: ['home'], skipped: [] });
  assert.deepEqual(pickWatched({}, 'migrate'), { watched: [], skipped: [] });
  const s = waitState({ units: { a: { status: 'failed', verdict: 'x' }, b: { status: 'running' }, c: { status: 'done' }, d: { status: 'pending' } } }, 'rollout', ['d', 'c', 'b', 'a', 'z']);
  assert.deepEqual(s, { ended: { a: { status: 'failed', verdict: 'x' }, c: { status: 'done' } }, running: ['b'], gone: [{ name: 'd', status: 'pending' }, { name: 'z', status: 'absent' }] });
  assert.deepEqual(Object.keys(s.ended), ['a', 'c']);
  assert.deepEqual(waitState({ units: {} }, 'rollout', []), { ended: {}, running: [], gone: [] });
});
check('wait helpers: waitBound (a notice over 600 s, clamped over 1500 s) and the three wait lines', () => {
  assert.deepEqual(waitBound(300), { sec: 300, notes: [] });
  assert.deepEqual(waitBound(600), { sec: 600, notes: [] });
  const n = waitBound(700);
  assert.equal(n.sec, 700);
  assert.deepEqual(n.notes, ['progress: --max 700 — a wait over 600 s buys nothing; a one-hour cache does not need it (a 300 s step costs about three cents and sees an ended unit up to 20 minutes sooner)']);
  const c = waitBound(2000);
  assert.equal(c.sec, 1500); assert.equal(c.notes.length, 2);
  assert.equal(c.notes[1], 'progress: --max 2000 clamped to 1500 s — wait in steps; the pause file ends a wait early');
  assert.equal(waitBound(1500).notes.length, 1);
  assert.equal(waitEndedLine(1, 2, ['b']), 'progress wait: 1 of 2 ended — still running: b');
  assert.equal(waitEndedLine(2, 2, []), 'progress wait: 2 of 2 ended — none still running');
  assert.equal(waitTimeoutLine(2, 300, ['a', 'b']), 'progress wait: none of 2 ended within 300s — still running: a, b — wait again as the next call');
  const p = { path: 'p.json', reason: 'stop', at: T0 };
  assert.equal(waitPausedLine(p, ['a', 'b']), `progress wait: paused — p.json present (reason: stop, at ${T0}) — start nothing new; still running: a, b`);
  assert.match(waitPausedLine(p, []), /— start nothing new; still running: none$/);
  assert.match(waitPausedLine(p, null), /— start nothing new; still running: unknown$/);
});
check('pauseState: unset / empty / missing = no pause; JSON {at, reason}; anything else still counts (reason unreadable); relative = from the cwd', () => {
  const d = project();
  assert.equal(pauseState(undefined, { cwd: d }), null);
  assert.equal(pauseState('', { cwd: d }), null);
  assert.equal(pauseState('  ', { cwd: d }), null);
  assert.equal(pauseState('p.json', { cwd: d }), null);
  put(join(d, 'p.json'), { at: T0, reason: 'budget\n spent' });
  assert.deepEqual(pauseState('p.json', { cwd: d }), { path: 'p.json', reason: 'budget spent', at: T0 });
  put(join(d, 'q.json'), {});
  assert.deepEqual(pauseState(join(d, 'q.json')), { path: join(d, 'q.json'), reason: 'unspecified', at: 'unknown' });
  for (const junk of ['not json', '[1]', 'null']) {
    put(join(d, 'r.json'), junk);
    assert.deepEqual(pauseState('r.json', { cwd: d }), { path: 'r.json', reason: 'unreadable', at: 'unknown' }, junk);
  }
});

// ---- show --waves (pure) --------------------------------------------------------------------------
const MID_RUN = {
  'foundation-chrome': { status: 'done', kind: 'foundation' },
  'foundation-styles': { status: 'done', kind: 'foundation' },
  'archetype-article': { status: 'running', kind: 'archetype', templates: ['article'] },
  'archetype-page': { status: 'done', kind: 'archetype' },
  'cluster-page': { status: 'running', kind: 'cluster', templates: ['page'] },
};
const TEMPLATES = [{ id: 'article', pageCount: 5 }, { id: 'page', pageCount: 3 }, { id: 'product', pageCount: 18 }, { id: 'home', pageCount: 1 }];
const MID_RUN_TEXT = [
  'progress waves rollout: stardust/rollout/progress.json — planned from coverage/templates.json; foundation frozen',
  'foundation: foundation-chrome done · foundation-styles done',
  'archetypes: archetype-article running · archetype-home planned · archetype-page done · archetype-product planned',
  'clusters: cluster-article planned (after archetype-article) · cluster-page running · cluster-product-1 planned (after archetype-product) · cluster-product-2 planned (after cluster-product-1)',
  'final: gate-all planned (after every unit above)',
  'can start now: archetype-home, archetype-product',
];
const unmetOf = (view, wave, name) => view.waves[wave].find((u) => u.name === name)?.after;
check('wavesView: a mid-run ledger + templates — planned units by the contract\'s names, unmet dependencies, can start now', () => {
  const v = wavesView(MID_RUN, { templates: TEMPLATES, frozen: true });
  assert.deepEqual(formatWaves(v, ROLLOUT), MID_RUN_TEXT);
  assert.equal(v.planned, true); assert.equal(v.frozen, true);
  assert.deepEqual(v.canStart, ['archetype-home', 'archetype-product']);
  assert.deepEqual(v.waves.foundation, [{ name: 'foundation-chrome', state: 'done', after: [] }, { name: 'foundation-styles', state: 'done', after: [] }]);
  assert.deepEqual(unmetOf(v, 'final', 'gate-all'), ['archetype-article', 'archetype-home', 'archetype-product', 'cluster-article', 'cluster-page', 'cluster-product-1', 'cluster-product-2']);
  assert.deepEqual(v.waves.other, []);
  const recordedOnly = wavesView(MID_RUN, { templates: null, frozen: true });
  assert.equal(recordedOnly.planned, false);
  assert.deepEqual(Object.values(recordedOnly.waves).flat().map((u) => u.name), Object.keys(MID_RUN));
  assert.match(formatWaves(recordedOnly, 'x.json')[0], /^progress waves rollout: x\.json — recorded units only \(no coverage\/templates\.json\); foundation frozen$/);
  assert.equal(formatWaves(recordedOnly, 'x.json')[4], 'final: none');
});
check('wavesView: the foundation first; before the freeze C0\'s archetype alone can start, and once an archetype is recorded the others wait for foundation-freeze', () => {
  const tpl = [{ id: 'article', pageCount: 4 }, { id: 'page', pageCount: 1 }];
  assert.deepEqual(wavesView({}, { templates: tpl }).canStart, ['foundation-chrome']);
  const chrome = wavesView({ 'foundation-chrome': { status: 'running' } }, { templates: tpl });
  assert.deepEqual(chrome.canStart, []);
  assert.deepEqual(unmetOf(chrome, 'foundation', 'foundation-styles'), ['foundation-chrome']);
  assert.deepEqual(unmetOf(chrome, 'archetypes', 'archetype-page'), ['foundation-chrome', 'foundation-styles', 'foundation-freeze']);
  const fdone = { 'foundation-chrome': { status: 'done' }, 'foundation-styles': { status: 'done' } };
  const before = wavesView(fdone, { templates: tpl });
  assert.deepEqual(before.canStart, [C0_ARCHETYPE]);
  assert.equal(C0_ARCHETYPE, "C0's archetype (archetype-<shell template>)");
  assert.deepEqual(unmetOf(before, 'archetypes', 'archetype-article'), ['foundation-freeze']);
  assert.deepEqual(unmetOf(before, 'clusters', 'cluster-article'), ['archetype-article', 'foundation-freeze']);
  assert.equal(formatWaves(before, ROLLOUT).at(-1), "can start now: C0's archetype (archetype-<shell template>)");
  assert.match(formatWaves(before, ROLLOUT)[0], /; foundation not frozen$/);
  const one = wavesView({ ...fdone, 'archetype-page': { status: 'running', kind: 'archetype' } }, { templates: tpl });
  assert.deepEqual(one.canStart, []);
  assert.match(formatWaves(one, ROLLOUT)[2], /^archetypes: archetype-article planned \(after foundation-freeze\) · archetype-page running$/);
  const c0failed = wavesView({ ...fdone, 'archetype-page': { status: 'failed', kind: 'archetype' } }, { templates: tpl });
  assert.deepEqual(c0failed.canStart, ['archetype-page'], 'a recorded archetype needs no freeze');
  assert.deepEqual(wavesView({ ...fdone, 'archetype-page': { status: 'done' } }, { templates: tpl, frozen: true }).canStart, ['archetype-article']);
});
check('wavesView: more than 16 siblings → sub-units cluster-<t>-1…n, each after the one before; the first after the archetype and the freeze', () => {
  const names = (pageCount) => wavesView({}, { templates: [{ id: 'p', pageCount }] }).waves.clusters.map((u) => u.name);
  assert.deepEqual(names(1), []);
  assert.deepEqual(names(2), ['cluster-p']);
  assert.deepEqual(names(17), ['cluster-p']);
  assert.deepEqual(names(18), ['cluster-p-1', 'cluster-p-2']);
  assert.deepEqual(names(34), ['cluster-p-1', 'cluster-p-2', 'cluster-p-3']);
  assert.deepEqual(names(162), Array.from({ length: 11 }, (_, i) => `cluster-p-${i + 1}`), 'sub-units in number order: -2 before -10');
  const map = { 'foundation-chrome': { status: 'done' }, 'foundation-styles': { status: 'done' }, 'archetype-p': { status: 'done' }, 'cluster-p-1': { status: 'done', kind: 'cluster' } };
  const v = wavesView(map, { templates: [{ id: 'p', pageCount: 40 }], frozen: true });
  assert.deepEqual(v.waves.clusters.map((u) => [u.name, u.state, u.after]), [['cluster-p-1', 'done', []], ['cluster-p-2', 'planned', []], ['cluster-p-3', 'planned', ['cluster-p-2']]]);
  assert.deepEqual(v.canStart, ['cluster-p-2']);
});
check('wavesView: a failed archetype can start again and holds its cluster; a recorded non-scheme cluster for a template stops planning cluster-<t>', () => {
  const base = { 'foundation-chrome': { status: 'done' }, 'foundation-styles': { status: 'done' } };
  const f = wavesView({ ...base, 'archetype-news': { status: 'failed', kind: 'archetype' } }, { templates: [{ id: 'news', pageCount: 6 }], frozen: true });
  assert.deepEqual(f.canStart, ['archetype-news']);
  assert.deepEqual(unmetOf(f, 'clusters', 'cluster-news'), ['archetype-news']);
  const custom = { ...base, 'archetype-news': { status: 'done' }, 'news-2024': { status: 'pending', kind: 'cluster', templates: ['news'] } };
  const c = wavesView(custom, { templates: [{ id: 'news', pageCount: 6 }, { id: 'big', pageCount: 30 }], frozen: false });
  assert.deepEqual(c.waves.clusters.map((u) => u.name), ['cluster-big-1', 'cluster-big-2', 'news-2024']);
  assert.deepEqual(unmetOf(c, 'clusters', 'news-2024'), ['foundation-freeze']);
  const whole = wavesView({ ...base, 'cluster-big': { status: 'running', templates: ['big'] } }, { templates: [{ id: 'big', pageCount: 30 }] });
  assert.deepEqual(whole.waves.clusters.map((u) => u.name), ['cluster-big'], 'a recorded whole cluster covers a template the scheme would split');
});
check('wavesView: kinds inferred from names, other: never starts; everything done but gate-all → can start now: gate-all', () => {
  const map = { 'gate-all': { status: 'pending' }, hotfix: { status: 'pending' }, 'foundation-chrome': { status: 'done' }, 'cluster-x': { status: 'done' }, 'archetype-x': { status: 'done' }, 'foundation-styles': { status: 'done', kind: 'foundation' } };
  const v = wavesView(map, { templates: [{ id: 'x', pageCount: 2 }], frozen: true });
  assert.deepEqual(Object.fromEntries(Object.entries(v.waves).map(([w, us]) => [w, us.map((u) => u.name)])), {
    foundation: ['foundation-chrome', 'foundation-styles'], archetypes: ['archetype-x'], clusters: ['cluster-x'], final: ['gate-all'], other: ['hotfix'],
  });
  assert.deepEqual(v.canStart, ['gate-all']);
  const text = formatWaves(v, ROLLOUT);
  assert.equal(text.at(-2), 'other: hotfix pending'); assert.equal(text.at(-1), 'can start now: gate-all');
  const open = wavesView({ ...map, 'cluster-x': { status: 'failed' } }, { templates: [{ id: 'x', pageCount: 2 }], frozen: true });
  assert.deepEqual(open.canStart, ['cluster-x']);
  assert.deepEqual(unmetOf(open, 'final', 'gate-all'), ['cluster-x']);
  assert.match(formatWaves(open, ROLLOUT).at(-3), /^final: gate-all pending \(after every unit above\)$/);
});
check('parseArgs: --waves on show only, rollout only, without a <name>', () => {
  assert.equal(parseArgs(['show', '--waves', '--json']).waves, true);
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), (e) => e.code === 2 && re.test(e.message), `${argv.join(' ')} → ${re}`);
  bad(['show', '--waves', '--ledger', 'migrate'], /^--waves reads the rollout ledger \(foundation → archetypes → clusters → final\)$/);
  bad(['show', '--waves', '--ledger', 'replica'], /^--waves reads the rollout ledger/);
  bad(['show', 'c1', '--waves'], /^show --waves shows every unit — drop the name c1$/);
  bad(['wait', '--waves'], /^--waves applies to show only$/);
  bad(['unit', 'start', 'c1', '--waves'], /^--waves applies to show only$/);
  bad(['show', '--waves', '--waves'], /--waves given twice/);
});

// ---- the CLI -----------------------------------------------------------------------------------
check('--help: exit 0, usage on stdout, nothing written (also before a bad flag)', () => {
  const d = project();
  const h = runIn(d, '--help');
  assert.equal(h.code, 0); assert.match(h.out, /Usage:/); assert.match(h.out, /progress\.mjs unit <start\|done\|failed> <name>/); assert.match(h.out, /Exit codes: 0/);
  assert.match(h.out, /progress\.mjs wait \[--ledger …\] \[--file …\] \[--unit <name>\]… \[--max <seconds>\] \[--json\]/);
  assert.match(h.out, /progress\.mjs show --waves \[--file …\] \[--json\]/);
  assert.match(h.out, /^show --waves /m);
  assert.match(h.out, /^wait: /m);
  assert.match(h.out, /75 wait: none ended within --max · 76 wait: the pause file is present/);
  assert.equal(runIn(d, 'unit', 'start', 'c1', '--frob', '-h').code, 0);
  assert.equal(runIn(d, 'wait', '--max', '-1', '--help').code, 0);
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
check('re-record via the CLI: unit done on a done unit keeps the subagent\'s endedAt and completes the fields; the line shape is unchanged', () => {
  const d = project();
  const file = join(d, ROLLOUT);
  put(file, { units: { c1: { status: 'done', startedAt: T0, endedAt: T1, verdict: 'pass' } } });
  const r = runIn(d, 'unit', 'done', 'c1', '--kind', 'cluster', '--pages', '12', '--blocks', '2', '--set', 'gates.1440={"archetype":1.3}');
  assert.equal(r.code, 0, r.err);
  assert.equal(oneLine(r.out), `progress rollout c1: done kind=cluster pages=12 blocks=2 startedAt=${T0} endedAt=${T1} verdict=pass`);
  assert.deepEqual(readJ(file).units.c1, { status: 'done', kind: 'cluster', pages: 12, blocks: 2, gates: { 1440: { archetype: 1.3 } }, startedAt: T0, endedAt: T1, verdict: 'pass' });
  const f = runIn(d, 'unit', 'failed', 'c1', '--verdict', 'fail: reopened');
  assert.equal(f.code, 0, f.err);
  const c1 = readJ(file).units.c1;
  assert.equal(c1.status, 'failed'); assert.match(c1.endedAt, ISO); assert.notEqual(c1.endedAt, T1);
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
check('show --waves via the CLI: the text view, --json, the header variants, notes for an absent ledger or an unreadable optional file; writes nothing', () => {
  const d = project();
  put(join(d, ROLLOUT), { units: MID_RUN });
  put(join(d, 'stardust', 'rollout', 'coverage', 'templates.json'), { templates: TEMPLATES, counts: { total: 27 } });
  put(join(d, 'stardust', 'rollout', 'foundation-freeze.json'), { frozenAt: T0, root: '.', paths: ['styles/'], files: {} });
  const inputs = [ROLLOUT, 'stardust/rollout/coverage/templates.json', 'stardust/rollout/foundation-freeze.json'];
  const snapshot = () => [readdirSync(join(d, 'stardust', 'rollout')), ...inputs.map((p) => readFileSync(join(d, p), 'utf8'))];
  const before = snapshot();
  const t = runIn(d, 'show', '--waves');
  assert.equal(t.code, 0, t.err); assert.equal(t.err, '');
  assert.equal(t.out, `${MID_RUN_TEXT.join('\n')}\n`);
  const j = runIn(d, 'show', '--waves', '--json');
  assert.equal(j.code, 0, j.err);
  const parsed = JSON.parse(oneLine(j.out));
  assert.deepEqual(Object.keys(parsed), ['ledger', 'frozen', 'planned', 'waves', 'canStart']);
  assert.deepEqual(parsed, { ledger: 'rollout', ...wavesView(MID_RUN, { templates: TEMPLATES, frozen: true }) });
  assert.deepEqual(Object.keys(parsed.waves), ['foundation', 'archetypes', 'clusters', 'final', 'other']);
  assert.deepEqual(snapshot(), before);
  put(join(d, 'stardust', 'rollout', 'foundation-freeze.json'), 'half');
  const u = runIn(d, 'show', '--waves');
  assert.equal(u.code, 0, u.err);
  assert.match(oneLine(u.err), /^progress: stardust\/rollout\/foundation-freeze\.json unreadable \(.+\) — treated as absent: foundation not frozen$/);
  assert.match(u.out, /^progress waves rollout: stardust\/rollout\/progress\.json — planned from coverage\/templates\.json; foundation not frozen\n/);
  rmSync(join(d, 'stardust', 'rollout', 'coverage'), { recursive: true });
  const r = runIn(d, 'show', '--waves', '--file', ROLLOUT);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^progress waves rollout: stardust\/rollout\/progress\.json — recorded units only \(no coverage\/templates\.json\); foundation not frozen\n/);
  const fresh = project();
  put(join(fresh, 'stardust', 'rollout', 'coverage', 'templates.json'), { templates: [{ id: 'page', pageCount: 1 }] });
  const n = runIn(fresh, 'show', '--waves');
  assert.equal(n.code, 0, n.err); assert.equal(n.err, `progress: no ${ROLLOUT}\n`);
  assert.equal(n.out, [
    `progress waves rollout: ${ROLLOUT} — planned from coverage/templates.json; foundation not frozen`,
    'foundation: foundation-chrome planned · foundation-styles planned (after foundation-chrome)',
    'archetypes: archetype-page planned (after foundation-chrome, foundation-styles, foundation-freeze)',
    'clusters: none',
    'final: gate-all planned (after every unit above)',
    'can start now: foundation-chrome',
  ].join('\n') + '\n');
  assert.ok(!existsSync(join(fresh, ROLLOUT)), 'show --waves creates no ledger');
  const m = runIn(d, 'show', '--waves', '--ledger', 'migrate');
  assert.equal(m.code, 2); assert.equal(m.out, '');
  assert.equal(m.err, 'progress: --waves reads the rollout ledger (foundation → archetypes → clusters → final)\n');
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

// ---- wait: the immediate outcomes ----------------------------------------------------------------
check('wait --max 0: one pass, exit 75 with the still-running line (and --json); needs no file-lock.mjs; writes nothing', () => {
  const d = project();
  put(join(d, ROLLOUT), { units: { b: { status: 'running', startedAt: T0 }, a: { status: 'running' }, c: { status: 'done' }, e: { status: 'pending' } } });
  const before = readFileSync(join(d, ROLLOUT), 'utf8');
  const r = runIn(d, 'wait', '--max', '0');
  assert.equal(r.code, 75, r.err); assert.equal(r.err, '');
  assert.equal(r.out, 'progress wait: none of 2 ended within 0s — still running: a, b — wait again as the next call\n');
  const j = runIn(d, 'wait', '--max', '0', '--json');
  assert.equal(j.code, 75, j.err); assert.deepEqual(JSON.parse(oneLine(j.out)), { ledger: 'rollout', ended: {}, running: ['a', 'b'], paused: null });
  const u = runIn(d, 'wait', '--max', '0', '--unit', 'b', '--unit', 'c', '--unit', 'z');
  assert.equal(u.code, 75, u.err); assert.equal(u.out, 'progress wait: none of 1 ended within 0s — still running: b — wait again as the next call\n');
  assert.equal(u.err, 'progress wait: --unit c is done — not watched\nprogress wait: --unit z is absent — not watched\n');
  const lone = project();
  const bare = join(lone, 'bin', 'progress.mjs');
  mkdirSync(dirname(bare)); copyFileSync(SCRIPT, bare);
  const b = runWith(bare, d, ['wait', '--max', '0']);
  assert.equal(b.code, 75, b.err);
  assert.equal(readFileSync(join(d, ROLLOUT), 'utf8'), before);
  assert.deepEqual(readdirSync(join(d, 'stardust', 'rollout')), ['progress.json'], 'no lock dir');
});
check('wait: the pause file at the start → exit 76 at once, before the ledger is read; not JSON still counts; empty = no check', () => {
  const d = project();
  put(join(d, ROLLOUT), running(['b', 'a']));
  const P = join(d, 'pause.json');
  put(P, { at: T0, reason: 'session budget' });
  const r = runWith(SCRIPT, d, ['wait', '--max', '30'], { STARDUST_PAUSE_FILE: P });
  assert.equal(r.code, 76, r.err); assert.ok(r.ms < 1500, `returned after ${r.ms} ms`); assert.equal(r.err, '');
  assert.equal(r.out, `progress wait: paused — ${P} present (reason: session budget, at ${T0}) — start nothing new; still running: a, b\n`);
  const u = runWith(SCRIPT, d, ['wait', '--unit', 'b'], { STARDUST_PAUSE_FILE: 'pause.json' });
  assert.equal(u.code, 76); assert.equal(u.out, `progress wait: paused — pause.json present (reason: session budget, at ${T0}) — start nothing new; still running: b\n`);
  put(P, 'half written');
  const j = runWith(SCRIPT, d, ['wait', '--json'], { STARDUST_PAUSE_FILE: 'pause.json' });
  assert.equal(j.code, 76); assert.equal(j.err, '');
  assert.deepEqual(JSON.parse(oneLine(j.out)), { ledger: 'rollout', ended: {}, running: ['a', 'b'], paused: { path: 'pause.json', reason: 'unreadable', at: 'unknown' } });
  const empty = project();
  const n = runWith(SCRIPT, empty, ['wait'], { STARDUST_PAUSE_FILE: P });
  assert.equal(n.code, 76, n.err); assert.match(n.out, /— start nothing new; still running: unknown\n$/, 'no ledger: the pause still wins');
  assert.deepEqual(readdirSync(empty), []);
  assert.equal(runWith(SCRIPT, d, ['wait', '--max', '0'], { STARDUST_PAUSE_FILE: '' }).code, 75);
  assert.equal(runWith(SCRIPT, d, ['wait', '--max', '0'], { STARDUST_PAUSE_FILE: join(d, 'absent.json') }).code, 75);
});
check('wait --max over 600: one stderr notice; over 1500: the notice and the clamp line; usage errors exit 2', () => {
  const d = project();
  put(join(d, ROLLOUT), running(['a']));
  const env = { STARDUST_PAUSE_FILE: 'pause.json' };
  put(join(d, 'pause.json'), { at: T0, reason: 'r' });
  const q = runWith(SCRIPT, d, ['wait', '--max', '600'], env);
  assert.equal(q.code, 76); assert.equal(q.err, '');
  const n = runWith(SCRIPT, d, ['wait', '--max', '700'], env);
  assert.equal(n.code, 76); assert.match(oneLine(n.err), /^progress: --max 700 — a wait over 600 s buys nothing; a one-hour cache does not need it/);
  const c = runWith(SCRIPT, d, ['wait', '--max', '2000'], env);
  assert.equal(c.code, 76);
  const lines = c.err.trimEnd().split('\n');
  assert.equal(lines.length, 2); assert.match(lines[0], /^progress: --max 2000 — a wait over 600 s/);
  assert.equal(lines[1], 'progress: --max 2000 clamped to 1500 s — wait in steps; the pause file ends a wait early');
  for (const [args, re] of [[['wait', '--max', '-1'], /--max needs a number of seconds ≥ 0, got "-1"/], [['wait', '--max', 'x'], /got "x"/],
    [['show', '--max', '3'], /--max applies to wait only/], [['wait', '--kind', 'cluster'], /--kind applies to unit only/], [['wait', 'a'], /unexpected argument/]]) {
    const r = runIn(d, ...args);
    assert.equal(r.code, 2, args.join(' ')); assert.match(oneLine(r.err), re); assert.equal(r.out, '');
  }
});
check('wait refusals (exit 2, one stderr line, nothing on stdout): no ledger, no unit running, none of the --unit names running, a shape refusal, not JSON', () => {
  const d = project();
  const no = (args, err) => { const r = runIn(d, ...args); assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`); assert.equal(r.out, ''); if (typeof err === 'string') assert.equal(r.err, `progress: ${err}\n`); else assert.match(oneLine(r.err), err); };
  no(['wait'], `no ${ROLLOUT}`);
  no(['wait', '--ledger', 'migrate'], `no ${MIGRATE}`);
  assert.deepEqual(readdirSync(d), []);
  put(join(d, ROLLOUT), { units: { a: { status: 'done' }, b: { status: 'pending' } } });
  no(['wait'], `no running unit in ${ROLLOUT} — nothing to wait for; progress.mjs show --waves lists what ended and what can start`);
  put(join(d, ROLLOUT), { units: { a: { status: 'done' }, c: { status: 'running' } } });
  no(['wait', '--unit', 'a', '--unit', 'b'], `no running unit among --unit a, b in ${ROLLOUT} (a: done, b: absent)`);
  put(join(d, REPLICA), { archetype: 'home', breakpoints: {} });
  no(['wait', '--ledger', 'replica'], /^progress: stardust\/replica\/progress\.json is one archetype's record at the top level/);
  put(join(d, 'x.json'), { units: { a: 'running' } });
  no(['wait', '--file', 'x.json'], /^progress: x\.json: units\.a is not an object$/);
  put(join(d, 'y.json'), '{ "units": ');
  no(['wait', '--file', 'y.json'], /^progress: y\.json is not JSON \(/);
});

// ---- wait over time ------------------------------------------------------------------------------
// Every scenario runs in its own project, all at once. The poll is 5 s; a change made 1.5 s after a wait starts (late
// enough that a slow node start has read the ledger first) is seen at the first poll, about 5 s in.
const TRIGGER_MS = 1500;
const runAsync = (cwd, args, env = {}) => new Promise((res) => {
  const t = Date.now();
  const c = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { err += b; });
  c.on('close', (code) => res({ code, out, err, ms: Date.now() - t }));
});
const after = (ms, fn) => new Promise((res) => { setTimeout(() => res(fn()), ms); });
const S = Object.fromEntries(['ends', 'max1', 'pause', 'narrow', 'ignores', 'json', 'gone', 'broken'].map((k) => [k, project()]));
for (const k of ['ends', 'narrow', 'ignores', 'gone']) put(join(S[k], ROLLOUT), running(['a', 'b']));
for (const k of ['max1', 'pause', 'broken']) put(join(S[k], ROLLOUT), running(['a']));
put(join(S.json, REPLICA), { _provenance: { writtenBy: 'gate-evidence.mjs' }, types: { home: { status: 'running', startedAt: T0 } } });
const [W, fired] = await Promise.all([
  Promise.all([
    runAsync(S.ends, ['wait', '--max', '30']),
    runAsync(S.max1, ['wait', '--max', '1']),
    runAsync(S.pause, ['wait', '--max', '30'], { STARDUST_PAUSE_FILE: 'pause.json' }),
    runAsync(S.narrow, ['wait', '--unit', 'b', '--unit', 'c', '--max', '8']),
    runAsync(S.ignores, ['wait', '--unit', 'b', '--max', '6']),
    runAsync(S.json, ['wait', '--ledger', 'replica', '--json', '--max', '30']),
    runAsync(S.gone, ['wait', '--max', '30']),
    runAsync(S.broken, ['wait', '--max', '6']),
  ]).then((rs) => Object.fromEntries(Object.keys(S).map((k, i) => [k, rs[i]]))),
  Promise.all([
    after(TRIGGER_MS, () => runAsync(S.ends, ['unit', 'done', 'a', '--verdict', 'pass'])),
    after(TRIGGER_MS, () => put(join(S.pause, 'pause.json'), { at: T1, reason: 'runner stop' })),
    after(TRIGGER_MS, () => runAsync(S.narrow, ['unit', 'done', 'a'])),
    after(TRIGGER_MS + 1000, () => runAsync(S.narrow, ['unit', 'failed', 'b', '--verdict', 'fail: 2 bands'])),
    after(TRIGGER_MS, () => runAsync(S.ignores, ['unit', 'done', 'a'])),
    after(TRIGGER_MS, () => runAsync(S.json, ['unit', 'done', 'home', '--ledger', 'replica', '--set', 'pageType=landing'])),
    after(TRIGGER_MS, () => put(join(S.gone, ROLLOUT), { units: { a: { status: 'pending' } } })),
    after(TRIGGER_MS, () => put(join(S.broken, ROLLOUT), '{ "units": { "a": ')),
  ]),
]);
check('wait: the unit done / failed calls made during the waits succeeded', () => {
  for (const f of fired) if (f) assert.equal(f.code, 0, f.err);
});
check('wait: a watched unit ends (unit done from another process) → exit 0 at the next poll: its line, then the summary naming the one still running', () => {
  const r = W.ends;
  assert.equal(r.code, 0, r.err); assert.equal(r.err, '');
  assert.equal(r.out, `${formatLine('rollout', 'a', readJ(join(S.ends, ROLLOUT)).units.a)}\nprogress wait: 1 of 2 ended — still running: b\n`);
  assert.match(r.out, /^progress rollout a: done kind=cluster startedAt=\S+ endedAt=\S+ verdict=pass\n/);
  assert.ok(r.ms >= TRIGGER_MS && r.ms < 7000, `returned after ${r.ms} ms`);
});
check('wait --max 1 → exit 75 after ≥ 1 s and < 6 s, naming the unit still running', () => {
  const r = W.max1;
  assert.equal(r.code, 75, r.err);
  assert.equal(r.out, 'progress wait: none of 1 ended within 1s — still running: a — wait again as the next call\n');
  assert.ok(r.ms >= 1000 && r.ms < 6000, `returned after ${r.ms} ms`);
});
check('wait: a pause file that appears during the wait (relative, from the cwd) ends it with 76 at the next poll', () => {
  const r = W.pause;
  assert.equal(r.code, 76, r.err);
  assert.equal(r.out, `progress wait: paused — pause.json present (reason: runner stop, at ${T1}) — start nothing new; still running: a\n`);
  assert.ok(r.ms < 7000, `returned after ${r.ms} ms`);
});
check('wait --unit narrows: an unwatched unit ending is not reported; the watched one failing ends the wait; a named unit not running gets a note', () => {
  const r = W.narrow;
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${formatLine('rollout', 'b', readJ(join(S.narrow, ROLLOUT)).units.b)}\nprogress wait: 1 of 1 ended — none still running\n`);
  assert.match(r.out, /^progress rollout b: failed .*verdict=fail: 2 bands\n/);
  assert.equal(r.err, 'progress wait: --unit c is absent — not watched\n');
});
check('wait --unit b: a ending mid-wait does not end it → exit 75 at --max', () => {
  const r = W.ignores;
  assert.equal(r.code, 75, r.err);
  assert.equal(r.out, 'progress wait: none of 1 ended within 6s — still running: b — wait again as the next call\n');
  assert.equal(readJ(join(S.ignores, ROLLOUT)).units.a.status, 'done');
  assert.ok(r.ms >= 6000, `returned after ${r.ms} ms`);
});
check('wait --json on the replica ledger: the ended record under its archetype name, nothing running, no pause', () => {
  const r = W.json;
  assert.equal(r.code, 0, r.err);
  const home = readJ(join(S.json, REPLICA)).types.home;
  assert.equal(home.status, 'done'); assert.equal(home.pageType, 'landing');
  assert.deepEqual(JSON.parse(oneLine(r.out)), { ledger: 'replica', ended: { home }, running: [], paused: null });
});
check('wait: every watched unit gone (pending again, removed) → a note each, then exit 2 "nothing left to wait for"', () => {
  const r = W.gone;
  assert.equal(r.code, 2); assert.equal(r.out, '');
  assert.equal(r.err, `progress wait: a is now pending — no longer watched\nprogress wait: b is now absent — no longer watched\nprogress: nothing left to wait for in ${ROLLOUT}; progress.mjs show --waves lists what ended and what can start\n`);
});
check('wait: a ledger that stops parsing is read again at each poll; still unreadable at the bound → exit 2 naming the file', () => {
  const r = W.broken;
  assert.equal(r.code, 2); assert.equal(r.out, '');
  const lines = r.err.trimEnd().split('\n');
  assert.equal(lines.length, 2, r.err);
  assert.match(lines[0], /^progress wait: stardust\/rollout\/progress\.json is not JSON \(.+\) — read again at the next poll$/);
  assert.match(lines[1], /^progress: stardust\/rollout\/progress\.json is not JSON \(.+\) — still unreadable at the end of the wait \(6s\)$/);
  assert.ok(r.ms >= 6000, `returned after ${r.ms} ms`);
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
