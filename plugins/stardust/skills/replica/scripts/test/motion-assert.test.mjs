#!/usr/bin/env node
// Deterministic test: skills/replica/scripts/motion-assert.mjs — the pure
// compare functions, the record writer and the CLI contract, without a
// browser. The browser half lives in evals/lint/motion-assert-fixtures.mjs
// (self-skips when playwright is not resolvable).
//
// Usage: node plugins/stardust/skills/replica/scripts/test/motion-assert.test.mjs  (exit 1 on findings)
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', 'motion-assert.mjs');
const FIX = join(HERE, '..', '..', '..', '..', 'evals', 'lint', 'fixtures', 'motion-assert');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };
const load = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

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
const help = run(['--help']);
check(help.status === 0 && /Usage:/.test(help.out) && /--record/.test(help.out) && /--skip/.test(help.out) && /--entrance-tolerance/.test(help.out) && /124/.test(help.out), 'motion-assert --help exits 0 and names the flags + exit codes');
check(run(['--bogus']).status === 2, 'unknown flag exits 2 (usage)');
// defect: header + HELP promised exit 3 (bot challenge) while nothing in the script could raise it — the exit table must stay truthful
check(!/bot challenge|· 3 /.test(help.out), `HELP does not promise an exit code the script cannot produce, got:\n${help.out}`);
{
  const src = readFileSync(SCRIPT, 'utf8');
  check(!/BotChallengeError|exit\(3\)|· 3 bot/.test(src), 'no exit 3 / BotChallengeError branch in motion-assert.mjs (it never opens the live origin)');
}
check(run([join(FIX, 'observe-v2.json')]).status === 2, 'missing <targetURL> exits 2');
check(run([join(tmpdir(), 'no-such-observe.json'), 'http://localhost:8791/home-proposed.html']).status === 2, 'unreadable observe JSON exits 2');
let r = run([join(FIX, 'observe-v2.json'), 'https://www.larkspurmutual.example/']);
check(r.status === 2 && /live origin/.test(r.out), `a target on the live origin is refused with exit 2, got ${r.status}\n${r.out}`);
r = run([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--skip', 'bogus=why']);
check(r.status === 2 && /--skip needs/.test(r.out), 'unknown --skip check exits 2');
r = run([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--record', join(FIX, 'progress.json')]);
check(r.status === 2 && /--slug/.test(r.out), '--record without --slug exits 2');
r = run([join(FIX, 'observe-v2.json'), 'http://localhost:8791/x.html', '--regime', 'live']);
check(r.status === 2, 'bad --regime exits 2');
r = run([join(FIX, 'observe-v2.json'), 'not a url']);
check(r.status === 2 && /not a URL/.test(r.out), 'a non-URL target exits 2');
// the script never imports playwright before the usage checks (static contract)
const src = readFileSync(SCRIPT, 'utf8');
check(!/^import .*from 'playwright'/m.test(src) && /await import\('playwright'\)/.test(src), 'playwright is imported lazily — usage/help never need a browser');
check(/never opens the live origin/i.test(src) && !/--allow-/.test(src), 'header states the live-origin rule; no allow-style bypass flag');

// --- deadline record path: no browser → the record writer alone (a temp ledger)
const tmp = mkdtempSync(join(tmpdir(), 'motion-assert-'));
try {
  const lp = join(tmp, 'progress.json'); writeFileSync(lp, readFileSync(join(FIX, 'progress.json')));
  const l2 = JSON.parse(readFileSync(lp, 'utf8'));
  record(l2, 'home', 360, noVerdict({ target: 't', regime: 'published-origin', observePath: 'o', schema: 2, width: 360, reason: 'deadline 90s' }));
  writeFileSync(lp, JSON.stringify(l2));
  const back = JSON.parse(readFileSync(lp, 'utf8'));
  check(back.archetypes[0].breakpoints['360'].motion.assert.verdict === 'none' && back.archetypes[0].breakpoints['360'].motion.assert.regime === 'published-origin' && back.archetypes[0].breakpoints['360'].result.pass === true, 'a none record round-trips next to an untouched result');
} finally { rmSync(tmp, { recursive: true, force: true }); }

if (failures.length) { console.error(`motion-assert.test: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('motion-assert.test: ok (compare functions, record writer, CLI contract — browser half: evals/lint/motion-assert-fixtures.mjs)');
