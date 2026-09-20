#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/motion-assert.mjs — pure half + browser half.
//
// Pure half (always): the compare functions (schema gate, chrome states/delta,
// widget advance, state machines, entrance tolerance, verdict), the record
// writer (breakpoints.<bp>.motion.assert on the archetype's page type, result
// untouched, deadline → verdict none) and the CLI contract (--help, usage
// exits, valued flags never swallow the next flag, live-origin refusal, no
// exit-3 promise the script cannot keep, lazy playwright import).
//
// Browser half (when playwright resolves from the repo, or STARDUST_GATE_DEPS
// names a node_modules that has it): the instrument against two local harness
// pages (file://, nothing live) with the same observe JSON (schema 2: header
// morph, a scrollLeft carousel that advanced live, a dead logo strip, three
// tile entrances, an aria-expanded FAQ):
//   live-like.html     → verdict pass, exit 0 (chrome / widgets / entrances /
//                        stateMachines / pageErrors all pass)
//   dead-carousel.html → verdict fail, exit 1, the widgets row names the
//                        control (`.cards-carousel .next`: no observable
//                        changed) — the recorded shape: measure() cached
//                        clientWidth 0 inside a display:none section; every
//                        static check on that page passes
//   observe-v1.json    → entrances / stateMachines `not-asserted` (schema 1),
//                        the rest asserted; verdict from the asserted checks
//   observe-static     → verdict n/a on a page whose header never morphs
//   --record           → breakpoints.1440.motion.assert written on the fixture
//                        ledger copy; result untouched
// Otherwise one SKIP line for the browser half; exit 0 when the pure half passed.
// Lives under evals/lint/ (not beside the script) so replica Setup step 4 copies
// no tests into projects.
//
// Usage: node plugins/stardust/evals/lint/motion-assert-fixtures.mjs  (exit 1 on findings)
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = join(import.meta.dirname, '..', '..');
const SCRIPT = join(PLUGIN, 'skills', 'replica', 'scripts', 'motion-assert.mjs');
const FIX = join(import.meta.dirname, 'fixtures', 'motion-assert');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// ---------------------------------------------------------------------------
// Pure half (always, no browser): the compare functions, the record writer and
// the CLI contract — every CLI case exits before a launch.
const load = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const runPure = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };
const { CHECKS, DEADLINE_EXIT, schemaGate, chromeStates, chromeDelta, compareChrome, activeDot, widgetAdvanced, stateChanged, entranceWithinTolerance, verdictOf, buildRecord, noVerdict, record, renderResult } = await import(SCRIPT);
const v2 = load('observe-v2.json'); const v1 = load('observe-v1.json'); const flat = load('observe-static.json');

// --- schema gate
check(schemaGate(v2).schema === 2 && schemaGate(v2).entrances && schemaGate(v2).stateMachines, 'schema 2 with entrances[]/stateMachines[] asserts (a) and (c)');
check(schemaGate(v1).schema === 1 && !schemaGate(v1).entrances && !schemaGate(v1).stateMachines, 'schema 1 → (a)/(c) not asserted');
check(CHECKS.length === 5 && DEADLINE_EXIT === 124, 'five named checks; 124 is the deadline exit');

// --- chrome states + compare
const S = chromeStates(v2.headerTimeline);
check(S.top.y === 0 && S.down.y === 2400 && S.up.y === 800 && S.back.y === 0 && S.back.dir === 'up', `four states picked: top 0 / deepest down 2400 / up nearest 800 / back 0, got ${JSON.stringify({ top: S.top.y, down: S.down.y, up: S.up.y, back: S.back.y })}`);
const d = chromeDelta(S.down, S.top);
check(d.position === 'fixed' && d.heightPx === 56 && JSON.stringify(d.added) === '["shrunk"]' && d.removed.length === 0, `class delta vs top = +shrunk, height 56, got ${JSON.stringify(d)}`);
check(chromeStates([]) === null && chromeStates(null) === null, 'empty timeline → null');
// v1 timeline (no dir) falls back to y ordering
const S1 = chromeStates(v1.headerTimeline);
check(S1.down.y === 2400 && S1.up.y === 800 && S1.back.y === 0, `older JSON without dir still yields the four states, got ${JSON.stringify({ down: S1.down.y, up: S1.up.y, back: S1.back.y })}`);

const same = compareChrome(v2.headerTimeline, v2.headerTimeline);
check(same.status === 'pass' && same.diffs.length === 0, 'identical timelines pass');
// target that never morphs (static header) vs a live that shrinks → fail naming the state
const staticTarget = v2.headerTimeline.map((h) => ({ ...h, cls: 'site-header', height: '80px' }));
let c = compareChrome(v2.headerTimeline, staticTarget);
check(c.status === 'fail' && c.diffs.some((x) => /^down: live morphs \(\+shrunk/.test(x)) && c.diffs.some((x) => /^up: /.test(x)), `static target vs morphing live fails at down/up, got ${JSON.stringify(c.diffs)}`);
// invented motion: live static, target morphs → fail (the double-header class of bug)
c = compareChrome(flat.headerTimeline, v2.headerTimeline);
check(c.status === 'fail' && c.diffs.some((x) => /live is static, target morphs/.test(x)), `invented target motion fails, got ${JSON.stringify(c.diffs)}`);
// a different class name for the same morph → fail on the class delta (mechanism cloning reuses live class names)
c = compareChrome(v2.headerTimeline, v2.headerTimeline.map((h) => ({ ...h, cls: h.cls.replace('shrunk', 'is-compact') })));
check(c.status === 'fail' && c.diffs.some((x) => /class delta \+shrunk − → \+is-compact/.test(x)), `renamed morph class is a delta, got ${JSON.stringify(c.diffs)}`);
// height within tolerance passes; beyond fails
c = compareChrome(v2.headerTimeline, v2.headerTimeline.map((h) => ({ ...h, height: h.height === '56px' ? '57px' : h.height })));
check(c.status === 'pass', 'height within ±2 px passes');
c = compareChrome(v2.headerTimeline, v2.headerTimeline.map((h) => ({ ...h, height: h.height === '56px' ? '64px' : h.height })));
check(c.status === 'fail' && c.diffs.some((x) => /height 56 → 64/.test(x)), 'height beyond tolerance fails');
check(compareChrome([], []).status === 'n/a' && compareChrome(v2.headerTimeline, [null, null]).status === 'fail', 'no header on either side = n/a; header missing on one side = fail');
check(compareChrome(flat.headerTimeline, flat.headerTimeline.map((h) => ({ ...h, position: 'sticky' }))).status === 'fail', 'position delta fails');

// --- widgets
check(widgetAdvanced(v2.widgetSamples[0].frames).advanced && widgetAdvanced(v2.widgetSamples[0].frames).by === 'boxScrollLeft', 'live carousel advanced by scrollLeft');
check(!widgetAdvanced(v2.widgetSamples[1].frames).advanced, 'the dead live widget did not advance (n/a — implement nothing)');
const deadFrames = [{ trackTransform: 'none', boxScrollLeft: 0, boxTransform: 'none', dots: [{ cls: 'dot active' }, { cls: 'dot' }] }, { trackTransform: 'none', boxScrollLeft: 0, boxTransform: 'none', dots: [{ cls: 'dot active' }, { cls: 'dot' }] }, { trackTransform: 'none', boxScrollLeft: 0, boxTransform: 'none', dots: [{ cls: 'dot active' }, { cls: 'dot' }] }];
check(!widgetAdvanced(deadFrames).advanced, 'dead-chevron frames (clientWidth cached at 0) must NOT read as advanced');
check(widgetAdvanced([{ trackTransform: 'matrix(1, 0, 0, 1, 0, 0)', dots: [] }, { trackTransform: 'matrix(1, 0, 0, 1, -320, 0)', dots: [] }]).by === 'trackTransform', 'track transform advance');
check(widgetAdvanced([{ trackTransform: 'none', dots: [{ cls: 'dot', current: true }, { cls: 'dot' }] }, { trackTransform: 'none', dots: [{ cls: 'dot' }, { cls: 'dot', current: true }] }]).by === 'activeDot', 'active dot advance (aria-current)');
check(!widgetAdvanced([{ trackTransform: 'none' }, { trackTransform: 'matrix(1, 0, 0, 1, 0, 0)' }]).advanced, 'none ↔ identity matrix is not movement');
check(activeDot([{ cls: 'slick-dots' }, { cls: 'slick-active' }]) === 1 && activeDot([]) === null, 'activeDot index / null');
check(!widgetAdvanced([]).advanced && !widgetAdvanced(null).advanced, 'no frames → not advanced');

// --- state machines
check(stateChanged({ ariaExpanded: 'false', controlsDisplay: 'none' }, { ariaExpanded: 'true', controlsDisplay: 'block' }).by === 'ariaExpanded', 'aria-expanded change detected first');
check(stateChanged({ ariaExpanded: null, controlsDisplay: 'none', className: 'faq__q' }, { ariaExpanded: null, controlsDisplay: 'block', className: 'faq__q' }).by === 'controlsDisplay', 'the revealed observable (controls display) counts, not only "opened"');
check(!stateChanged({ ariaExpanded: 'false', open: false, className: 'x', childCount: 40 }, { ariaExpanded: 'false', open: false, className: 'x', childCount: 40 }).changed, 'nothing changed → false');
check(!stateChanged(null, {}).changed, 'missing snapshot → false');

// --- entrances tolerance
check(entranceWithinTolerance(30, 28, 0.1) && !entranceWithinTolerance(30, 26, 0.1) && entranceWithinTolerance(0, 0) && !entranceWithinTolerance(0, 2) && !entranceWithinTolerance(NaN, 1), 'entrance tolerance ±10 %; live 0 → target must be 0');

// --- verdict + record
check(verdictOf({ a: { status: 'pass' }, b: { status: 'not-asserted' } }) === 'pass' && verdictOf({ a: { status: 'pass' }, b: { status: 'fail' } }) === 'fail' && verdictOf({ a: { status: 'n/a' }, b: { status: 'not-asserted' }, c: { status: 'skipped' } }) === 'n/a', 'verdict: fail > pass > n/a; not-asserted/skipped never decide');
const rec = buildRecord({ checks: { chrome: { status: 'pass' }, widgets: { status: 'pass' }, pageErrors: { status: 'pass' }, entrances: { status: 'not-asserted' }, stateMachines: { status: 'not-asserted' } }, skips: {}, target: 'http://localhost:8791/home-proposed.html', regime: 'prototype', observePath: 'stardust/replica/motion/home.json', schema: 1, width: 1440, at: '2026-09-20T10:00:00Z' });
check(rec.verdict === 'pass' && rec.regime === 'prototype' && rec.schema === 1 && rec.width === 1440 && rec.at === '2026-09-20T10:00:00Z', 'record carries verdict, regime, observe, schema, width, at');
const nv = noVerdict({ target: 'x', regime: 'prototype', observePath: 'o', schema: 2, width: 360, reason: 'deadline' });
check(nv.verdict === 'none' && nv.reason === 'deadline' && Object.keys(nv.checks).length === 0, 'deadline → verdict none, never fail');
check(/⏱ none/.test(renderResult(nv)) && /🟡 FAIL/.test(renderResult({ ...rec, verdict: 'fail' })) && /advisory this release \(D15/.test(renderResult({ ...rec, verdict: 'fail' })), 'render: none is a clock, fail is 🟡 advisory (D15)');

const ledger = load('progress.json');
const beforeResult = JSON.stringify(ledger.archetypes[0].breakpoints['1440'].result); const beforeMotion = JSON.stringify(ledger.archetypes[0].motion);
let w = record(ledger, 'home', 1440, rec);
check(w.written && w.pageType === 'landing' && ledger.archetypes[0].breakpoints['1440'].motion.assert.verdict === 'pass', 'record writes breakpoints.1440.motion.assert on the archetype\'s page type');
check(JSON.stringify(ledger.archetypes[0].breakpoints['1440'].result) === beforeResult && JSON.stringify(ledger.archetypes[0].motion) === beforeMotion && ledger.archetypes[0].breakpoints['1440'].iterations === 2, 'result, iterations and motion.{observed,implemented,dead} untouched');
w = record(ledger, 'home', 768, nv);
check(w.written && ledger.archetypes[0].breakpoints['768'].motion.assert.verdict === 'none' && !ledger.archetypes[0].breakpoints['768'].result, 'a breakpoint block without a result is created for the record only');
check(!record(ledger, 'nobody', 1440, rec).written, 'unknown archetype → not written (printed by the CLI, never restructured)');
check(record({ pageTypes: { landing: { archetype: 'home' } } }, 'home', 360, rec).written, 'pageTypes{} alias accepted by the shared reader');

// --- CLI contract (no browser reached: every case exits before launch)
const help = runPure(['--help']);
check(help.status === 0 && /Usage:/.test(help.out) && /--record/.test(help.out) && /--skip/.test(help.out) && /--entrance-tolerance/.test(help.out) && /124/.test(help.out), 'motion-assert --help exits 0 and names the flags + exit codes');
check(runPure(['--bogus']).status === 2, 'unknown flag exits 2 (usage)');
// defect: --record/--slug (and every valued flag) swallowed the next flag as their value (`--record --slug home` recorded to a file named "--slug")
for (const args of [['--record', '--slug', 'home'], ['--slug', '--json'], ['--width', '--json'], ['--control', '--skip', 'chrome=x'], ['--regime'], ['--timeout', '--json']]) { const r = runPure([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', ...args]); check(r.status === 2 && /needs a value/.test(r.out), `${args.join(' ')}: a flag without a value exits 2 with "needs a value", got ${r.status}\n${r.out.split('\n')[0]}`); }
// defect: header + HELP promised exit 3 (bot challenge) while nothing in the script could raise it — the exit table must stay truthful
check(!/bot challenge|· 3 /.test(help.out), `HELP does not promise an exit code the script cannot produce, got:\n${help.out}`);
{
  const src = readFileSync(SCRIPT, 'utf8');
  check(!/BotChallengeError|exit\(3\)|· 3 bot/.test(src), 'no exit 3 / BotChallengeError branch in motion-assert.mjs (it never opens the live origin)');
}
check(runPure([join(FIX, 'observe-v2.json')]).status === 2, 'missing <targetURL> exits 2');
check(runPure([join(tmpdir(), 'no-such-observe.json'), 'http://localhost:8791/home-proposed.html']).status === 2, 'unreadable observe JSON exits 2');
let r = runPure([join(FIX, 'observe-v2.json'), 'https://www.larkspurmutual.example/']);
check(r.status === 2 && /live origin/.test(r.out), `a target on the live origin is refused with exit 2, got ${r.status}\n${r.out}`);
r = runPure([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--skip', 'bogus=why']);
check(r.status === 2 && /--skip needs/.test(r.out), 'unknown --skip check exits 2');
r = runPure([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--record', join(FIX, 'progress.json')]);
check(r.status === 2 && /--slug/.test(r.out), '--record without --slug exits 2');
r = runPure([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--regime', 'live']);
check(r.status === 2, 'bad --regime exits 2');
r = runPure([join(FIX, 'observe-v2.json'), 'not a url']);
check(r.status === 2 && /not a URL/.test(r.out), 'a non-URL target exits 2');
// the script never imports playwright before the usage checks (static contract)
const src = readFileSync(SCRIPT, 'utf8');
check(!/^import .*from 'playwright'/m.test(src) && /await import\('playwright'\)/.test(src), 'playwright is imported lazily — usage/help never need a browser');
// launch-ladder parity (T20.2 § Script work "open target via live-session"): the browser comes from live-session launchTier, never a bare chromium.launch()
check(!/chromium\.launch\(/.test(src) && /launchTier\(chromium/.test(src) && /live-session\.mjs/.test(src), 'the target is opened through live-session launchTier (two-layout lookup), not chromium.launch()');
check(/e\.code === 124 \? DEADLINE_EXIT/.test(src), 'a launchTier slot timeout (code 124) exits 124 — no verdict, never 1');
check(/never opens the live origin/i.test(src) && !/--allow-/.test(src), 'header states the live-origin rule; no allow-style bypass flag');

// --- deadline record path: no browser → the record writer alone (a temp ledger)
const tmpPure = mkdtempSync(join(tmpdir(), 'motion-assert-pure-'));
try {
  const lp = join(tmpPure, 'progress.json'); writeFileSync(lp, readFileSync(join(FIX, 'progress.json')));
  const l2 = JSON.parse(readFileSync(lp, 'utf8'));
  record(l2, 'home', 360, noVerdict({ target: 't', regime: 'published-origin', observePath: 'o', schema: 2, width: 360, reason: 'deadline 90s' }));
  writeFileSync(lp, JSON.stringify(l2));
  const back = JSON.parse(readFileSync(lp, 'utf8'));
  check(back.archetypes[0].breakpoints['360'].motion.assert.verdict === 'none' && back.archetypes[0].breakpoints['360'].motion.assert.regime === 'published-origin' && back.archetypes[0].breakpoints['360'].result.pass === true, 'a none record round-trips next to an untouched result');
} finally { rmSync(tmpPure, { recursive: true, force: true }); }

const finish = (tail) => {
  if (failures.length) { console.error(`motion-assert-fixtures: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log(`motion-assert-fixtures: ok (compare functions, record writer, CLI contract; browser half: ${tail})`);
  process.exit(0);
};

// ---------------------------------------------------------------------------
// Browser half: self-skips (one SKIP line, exit 0 after the pure half's verdict)
// when playwright is not resolvable.
let deps = null;
try { await import('playwright'); deps = 'repo'; } catch { /* not at the repo root */ }
if (!deps && process.env.STARDUST_GATE_DEPS && existsSync(join(process.env.STARDUST_GATE_DEPS, 'playwright'))) deps = process.env.STARDUST_GATE_DEPS;
if (!deps) { console.log('motion-assert-fixtures: SKIP browser half — playwright not resolvable (set STARDUST_GATE_DEPS=<dir>/node_modules, or npm i -D playwright at the repo root); the pure half above ran'); finish('SKIP'); }

// Run from a temp copy of the replica scripts dir so a borrowed node_modules
// resolves for the script (ESM resolution walks up from the script's path).
const tmp = mkdtempSync(join(tmpdir(), 'motion-assert-fx-'));
try {
  let script = SCRIPT;
  if (deps !== 'repo') {
    cpSync(join(PLUGIN, 'skills', 'replica', 'scripts'), join(tmp, 'skills', 'replica', 'scripts'), { recursive: true });
    cpSync(join(PLUGIN, 'skills', 'replica', 'reference'), join(tmp, 'skills', 'replica', 'reference'), { recursive: true });
    cpSync(join(PLUGIN, 'skills', 'diff', 'scripts'), join(tmp, 'skills', 'diff', 'scripts'), { recursive: true }); // live-session.mjs (the launcher) sits beside the replica scripts in both layouts
    for (const sk of ['deploy', 'dynamics']) cpSync(join(PLUGIN, 'skills', sk, 'scripts'), join(tmp, 'skills', sk, 'scripts'), { recursive: true }); // qa-gate + its driveControl import (T20.2 PR B)
    symlinkSync(resolve(deps), join(tmp, 'node_modules'));
    script = join(tmp, 'skills', 'replica', 'scripts', 'motion-assert.mjs');
  }
  const ledger = join(tmp, 'progress.json'); writeFileSync(ledger, readFileSync(join(FIX, 'progress.json')));
  const url = (f) => pathToFileURL(join(FIX, f)).href;
  const run = (args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 90000 }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };

  let r = run([join(FIX, 'observe-v2.json'), url('live-like.html'), '--record', ledger, '--slug', 'home', '--json']);
  let j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 0 && j?.verdict === 'pass', `live-like: verdict pass, exit 0 — got ${r.status}\n${r.out}`);
  check(j?.checks?.chrome?.status === 'pass' && j?.checks?.widgets?.status === 'pass' && j?.checks?.entrances?.status === 'pass' && j?.checks?.stateMachines?.status === 'pass' && j?.checks?.pageErrors?.status === 'pass', `live-like: every check passes — got ${JSON.stringify(j?.checks && Object.fromEntries(Object.entries(j.checks).map(([k, v]) => [k, `${v.status}: ${v.detail}`])))}`);
  check(/logo-strip \.next: n\/a/.test(j?.checks?.widgets?.detail || ''), 'live-like: the dead live widget is n/a (implement nothing)');
  const led = JSON.parse(readFileSync(ledger, 'utf8'));
  check(led.archetypes[0].breakpoints['1440'].motion?.assert?.verdict === 'pass' && led.archetypes[0].breakpoints['1440'].result.pixelPct === 2.14 && led.archetypes[0].motion.dead[0] === 'logo-strip-next', '--record: motion.assert written under breakpoints.1440; result and motion inventory untouched');

  r = run([join(FIX, 'observe-v2.json'), url('dead-carousel.html'), '--json']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 1 && j?.verdict === 'fail', `dead-carousel: verdict fail, exit 1 — got ${r.status}\n${r.out}`);
  check(j?.checks?.widgets?.status === 'fail' && /cards-carousel \.next: fail \(control .*no observable changed/.test(j?.checks?.widgets?.detail || ''), `dead-carousel: the widgets row names the dead control — got ${j?.checks?.widgets?.detail}`);
  check(j?.checks?.pageErrors?.status === 'pass' && j?.checks?.chrome?.status === 'pass', 'dead-carousel: every static check passes — only the control drive sees it');
  const text = run([join(FIX, 'observe-v2.json'), url('dead-carousel.html')]);
  check(/🟡 FAIL/.test(text.out) && /advisory this release \(D15/.test(text.out), 'text verdict is 🟡 advisory (D15 re-proposal)');

  r = run([join(FIX, 'observe-v1.json'), url('live-like.html'), '--json']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 0 && j?.verdict === 'pass' && j?.schema === 1 && j?.checks?.entrances?.status === 'not-asserted' && j?.checks?.stateMachines?.status === 'not-asserted', `schema 1: (a)/(c) not-asserted, the rest asserted — got ${r.status} ${JSON.stringify(j?.checks && Object.fromEntries(Object.entries(j.checks).map(([k, v]) => [k, v.status])))}`);

  r = run([join(FIX, 'observe-static.json'), url('live-like.html'), '--json', '--skip', 'entrances=fixture page has tiles the static observe does not']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 1 && j?.checks?.chrome?.status === 'fail' && /live is static, target morphs/.test(j?.checks?.chrome?.detail || '') && j?.skips?.entrances, `static live vs morphing target = invented motion, fail; --skip reason recorded — got ${r.status} ${j?.checks?.chrome?.detail}`);

  // T20.2 PR B — deploy qa-gate's control pass (dynamics lib.mjs driveControl) names the dead chevron; the faq toggle changes an observable
  const qaGate = deps !== 'repo' ? join(tmp, 'skills', 'deploy', 'scripts', 'qa-gate.mjs') : join(PLUGIN, 'skills', 'deploy', 'scripts', 'qa-gate.mjs');
  const qg = spawnSync(process.execPath, [qaGate, url('dead-carousel.html')], { encoding: 'utf8', timeout: 90000, cwd: tmp });
  const qgOut = `${qg.stdout}${qg.stderr}`;
  check(/control button\.next\[aria-label="Next"\] in block cards-carousel: no observable changed/.test(qgOut), `qa-gate control pass names the dead chevron (🟡 advisory) — got:\n${qgOut.split('\n').filter((l) => /control/.test(l)).join('\n')}`);
  check(/control button\.faq__q in block faq: aria-expanded changed/.test(qgOut), 'qa-gate control pass: the faq toggle is a live control (aria-expanded changed)');
  check(/⚠ control .*no observable changed/.test(qgOut) && !/✗ control /.test(qgOut), 'the dead control is a WARN line, not a FAIL (D15 pending — B30 stands)');
  const qgNo = spawnSync(process.execPath, [qaGate, url('dead-carousel.html'), '--no-drive'], { encoding: 'utf8', timeout: 90000, cwd: tmp });
  check(/control pass skipped \(--no-drive\)/.test(`${qgNo.stdout}${qgNo.stderr}`) && !/no observable changed/.test(`${qgNo.stdout}${qgNo.stderr}`), '--no-drive skips the pass and says so');

  r = run([join(FIX, 'observe-v2.json'), url('live-like.html'), '--timeout', '1', '--record', ledger, '--slug', 'home', '--width', '360']);
  check(r.status === 124 && /⏱ none/.test(r.out), `--timeout expiry exits 124 with verdict none — got ${r.status}\n${r.out}`);
  const led2 = JSON.parse(readFileSync(ledger, 'utf8'));
  check(led2.archetypes[0].breakpoints['360'].motion?.assert?.verdict === 'none' && led2.archetypes[0].breakpoints['360'].result.pass === true, 'deadline record: verdict none under breakpoints.360, result untouched');
} finally { rmSync(tmp, { recursive: true, force: true }); }

finish(`live-like pass, dead carousel named, schema-1 not-asserted, invented motion fails, --record, 124 → none, qa-gate control pass names the dead chevron [deps: ${deps}]`);
