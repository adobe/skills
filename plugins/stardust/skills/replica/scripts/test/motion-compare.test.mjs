#!/usr/bin/env node
// skills/replica/scripts/test/motion-compare.test.mjs — the motion-compare.mjs contract on
// synthetic motion-observe fixtures: parity, MISSING / EXTRA on build, the tolerance boundary
// (timing and magnitude, inclusive), the dead-on-live exemption, probe pairing by order, the
// double-header defect, --json, and bad input (exit 2). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerProfile, maxTimeMs, normaliseHoverKey, pairProbes, translateOf, widgetProfile } from '../motion-compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'motion-compare.mjs');
const dir = mkdtempSync(join(tmpdir(), 'motion-compare-test-'));
let n = 0;
const save = (obj) => { const p = join(dir, `obs-${n += 1}.json`); writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const cmp = (live, build, ...flags) => run(save(live), save(build), ...flags);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// ---- fixture builders (shape of motion-observe.mjs output) ----------------------------------------
// headerTimeline: the observer samples y=0 first, then every 1200px on the way down, then a fixed
// upward grid with dense sampling near the top. A sample is the computed header state at that y.
function timeline({ topH = 190, scrolledH = 110, restoreAt = 60, transition = 'height 0.5s ease 0s', count = 1, morph = true, docH = 6000 } = {}) {
  const ys = [0, 0, 1200, 2400, 3600, 4800, docH - 2000, docH - 3500, 2400, 1200, 800, 500, 300, 200, 150, 120, 90, 60, 30, 0];
  return ys.map((y, i) => {
    const scrolled = morph && (i < 6 ? y > 0 : y > restoreAt);
    return { y, cls: scrolled ? 'header scrolled' : 'header', position: 'fixed', height: `${scrolled ? scrolledH : topH}px`, transform: 'none', transition, mainPadTop: `${topH}px`, bodyPadTop: '0px', headerCount: count };
  });
}
// widget frames: 4 samples ~200 ms apart; `settleAt` = index of the last frame that still changes.
function widget(sel, { travel = 320, settleAt = 2, transition = 'transform 0.4s ease 0s', dots = false, error = null } = {}) {
  if (error) return { sel, error };
  const frames = [0, 1, 2, 3].map((i) => {
    const done = i >= settleAt;
    const x = travel === null ? 0 : (done ? -travel : -(travel * i) / settleAt);
    return { t: 1000 + i * 200, trackTransform: travel === null ? 'none' : `matrix(1, 0, 0, 1, ${x}, 0)`, trackTransition: transition, boxScrollLeft: null, boxTransform: null, dots: dots ? [{ cls: done ? 'indicator-active' : '', w: '8px', h: '8px', bg: 'rgb(0, 0, 0)', transition: 'width 0.3s' }] : [] };
  });
  return { sel, frames };
}
function hover(sel, changed = ['self.color', 'span.icon.brand.transform'], transition = 'color 0.2s ease 0s', error = null) {
  if (error) return { sel, error };
  const st = (c) => ({ transform: 'none', color: c, background: 'rgba(0, 0, 0, 0)', boxShadow: 'none', opacity: '1', transition });
  return { sel, changed, before: { self: st('rgb(0, 0, 0)'), subs: [{ el: 'span.icon.brand', ...st('rgb(0, 0, 0)') }] }, after: { self: st('rgb(255, 0, 0)'), subs: [{ el: 'span.icon.brand', ...st('rgb(0, 0, 0)') }] } };
}
const anim = (name, count, y = 900) => Array.from({ length: count }, (_, i) => ({ name, el: `section > div.card.animate`, txt: `card ${i + 1}`, y: y + i * 50 }));
const trans = (prop, count, dur = '0.5s') => Array.from({ length: count }, () => ({ prop, el: 'div.container.header', y: 400, dur }));
const cls = (added, count) => Array.from({ length: count }, () => ({ added: [added], el: 'html > body.page', y: 400 }));

function obs({ header = {}, widgets = [widget('.next')], hovers = [hover('.card')], animations = anim('fadeIn', 3), transitions = trans('padding-top', 2), classes = cls('scrolled', 2), width = 1440 } = {}) {
  return { url: 'https://example.test/', width, headerTimeline: header === null ? [null] : timeline(header), widgetSamples: widgets, hoverSamples: hovers, events: { animations, transitions, classMutations: classes } };
}

// ---- unit: reducers -------------------------------------------------------------------------------
check('parsers: longest time token, matrix translation, hover key normalisation', () => {
  assert.equal(maxTimeMs('0.5s, 0.5s'), 500); assert.equal(maxTimeMs('all 0.3s ease 0s'), 300); assert.equal(maxTimeMs('300ms'), 300); assert.equal(maxTimeMs('all'), null); assert.equal(maxTimeMs(null), null);
  assert.deepEqual(translateOf('matrix(1, 0, 0, 1, -320, 0)'), { x: -320, y: 0 }); assert.deepEqual(translateOf('none'), { x: 0, y: 0 });
  assert.equal(translateOf('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -640, 12, 0, 1)').x, -640);
  assert.equal(normaliseHoverKey('self.color'), 'self.color'); assert.equal(normaliseHoverKey('span.icon.brand.transform'), 'span.transform'); assert.equal(normaliseHoverKey('img.color'), 'img.color');
});
check('headerProfile: top vs scrolled state, restore threshold, transition time, count', () => {
  const p = headerProfile(timeline({ topH: 190, scrolledH: 110, restoreAt: 60 }));
  assert.equal(p.morphs, true); assert.equal(p.heightDelta, 80); assert.equal(p.restoreY, 60); assert.equal(p.timeMs, 500); assert.equal(p.maxCount, 1); assert.equal(p.mainComp, 0);
  const s = headerProfile(timeline({ morph: false })); assert.equal(s.morphs, false);
  assert.equal(headerProfile([null, null]).present, false);
});
check('widgetProfile: fired, settle time, travel, transition time; dead when frames never change', () => {
  const p = widgetProfile(widget('.next', { travel: 320, settleAt: 2 }));
  assert.equal(p.fired, true); assert.equal(p.settleMs, 400); assert.equal(p.travel, 320); assert.equal(p.timeMs, 400);
  const d = widgetProfile(widget('.tab', { travel: null })); assert.equal(d.fired, false); assert.equal(d.settleMs, null);
  assert.equal(widgetProfile({ sel: '.x', error: 'not found' }).observed, false);
});
check('pairProbes: by selector first, leftovers in order, build-only tail', () => {
  const pairs = pairProbes([{ sel: 'a' }, { sel: 'b' }, { sel: 'c' }], [{ sel: 'c' }, { sel: 'x' }, { sel: 'y' }, { sel: 'z' }]);
  assert.deepEqual(pairs.map((p) => [p.live?.sel ?? null, p.build?.sel ?? null, p.by]), [['a', 'x', 'order'], ['b', 'y', 'order'], ['c', 'c', 'selector'], [null, 'z', null]]);
});

// ---- CLI: parity ------------------------------------------------------------------------------------
check('identical observations: every behavior parity, summary PASS, exit 0', () => {
  const r = cmp(obs(), obs());
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^motion header scroll-morph: parity \(Δheight 80px, restore at y≤60, 500ms\)$/m);
  assert.match(r.out, /^motion widget \.next: parity \(travel 320px, settle 400ms, transition 400ms\)$/m);
  assert.match(r.out, /^motion hover \.card: parity \(self\.color, span\.transform; 200ms\)$/m);
  assert.match(r.out, /^motion entrance fadeIn: parity \(fired on 3 element\(s\)\)$/m);
  assert.match(r.out, /^motion transition padding-top: parity/m);
  assert.match(r.out, /^motion class scrolled: parity/m);
  assert.match(r.out, /^motion summary: 6 behaviors — 6 parity, 0 missing on build, 0 extra on build, 0 out of tolerance, 0 dead on live \(not required\) {2}\(tolerance 150ms \/ 8px\) → PASS$/m);
  assert.doesNotMatch(r.out, /MISSING|EXTRA/);
});

// ---- CLI: missing -----------------------------------------------------------------------------------
check('behaviors that fired on live but not on the build are MISSING on build, exit 1', () => {
  const build = obs({ header: { morph: false }, widgets: [widget('.next', { travel: null })], hovers: [hover('.card', [])], animations: [], transitions: [], classes: [] });
  const r = cmp(obs(), build);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^motion header scroll-morph: MISSING on build \(live morphs 80px at depth; build static\)$/m);
  assert.match(r.out, /^motion widget \.next: MISSING on build \(no sampled change on build; live travel 320px/m);
  assert.match(r.out, /^motion hover \.card: MISSING on build \(no hover diff on build; live changes self\.color, span\.transform/m);
  assert.match(r.out, /^motion entrance fadeIn: MISSING on build \(fired on 3 element\(s\) on live\)$/m);
  assert.match(r.out, /^motion transition padding-top: MISSING on build/m);
  assert.match(r.out, /^motion class scrolled: MISSING on build \(trigger class added 2× on live, never on build\)$/m);
  assert.match(r.out, /6 missing on build.*→ FAIL$/m);
});
check('a build probe that finds no element or has no pairing partner is MISSING when live fired', () => {
  const r = cmp(obs({ widgets: [widget('.next'), widget('.prev')], hovers: [hover('.card')] }), obs({ widgets: [widget('.next', { error: 'not found' })], hovers: [] }));
  assert.equal(r.code, 1);
  assert.match(r.out, /^motion widget \.next: MISSING on build \(build probe not found; live travel 320px/m);
  assert.match(r.out, /^motion widget \.prev: MISSING on build \(no build poke pairs with it/m);
  assert.match(r.out, /^motion hover \.card: MISSING on build \(no build probe pairs with it/m);
});

// ---- CLI: extra ---------------------------------------------------------------------------------------
check('behaviors the build invents on a complete channel are EXTRA on build, exit 1; a widget/hover/transition the sampler could not see on live is advisory', () => {
  const live = obs({ header: { morph: false }, widgets: [widget('.tab', { travel: null })], hovers: [hover('.card', [])], animations: [], transitions: [] });
  const build = obs({ header: { morph: true }, widgets: [widget('.tab', { travel: 200 })], hovers: [hover('.card', ['self.background'])], animations: anim('slideUp', 4), transitions: trans('transform', 1) });
  const r = cmp(live, build);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^motion header scroll-morph: EXTRA on build \(live header static across the scroll traversal, build changes 80px\)$/m);
  assert.match(r.out, /^motion entrance slideUp: EXTRA on build \(fired on 4 element\(s\) on build, never on live\)$/m);
  assert.match(r.out, /^motion widget \.tab: extra on build — advisory \(no sampled change on live; build changes on click — live mechanics may be invisible to the frame sampler/m);
  assert.match(r.out, /^motion hover \.card: extra on build — advisory \(no hover diff on live; build changes self\.background — live mechanics may be invisible to the hover probe/m);
  assert.match(r.out, /^motion transition transform: extra on build — advisory \(1 event\(s\) on build, none on live/m);
  assert.match(r.out, /2 extra on build.*, 3 advisory.*→ FAIL$/m);
  // the same blind-spot cases alone never fail the gate (recorded: a class-toggled live carousel reads as
  // dead to the frame sampler while its --active classes fire; a faithful scroll-snap rebuild must not FAIL)
  const onlyBlind = cmp(live, obs({ header: { morph: false }, widgets: [widget('.tab', { travel: 200 })], hovers: [hover('.card', ['self.background'])], animations: [], transitions: trans('transform', 1) }));
  assert.equal(onlyBlind.code, 0, onlyBlind.out);
  assert.match(onlyBlind.out, /0 extra on build.*, 3 advisory.*→ PASS$/m);
  // a live page with no header element at all and a build header that morphs: still a hard EXTRA, worded for that case
  const noHeader = cmp(obs({ header: null }), obs());
  assert.equal(noHeader.code, 1);
  assert.match(noHeader.out, /^motion header scroll-morph: EXTRA on build \(no header element observed on live, build changes 80px\)$/m);
});
check('an extra trigger class on the build is advisory only, not a failure', () => {
  const r = cmp(obs(), obs({ classes: [...cls('scrolled', 2), ...cls('is-ready', 1)] }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^motion class is-ready: extra on build — advisory/m); assert.match(r.out, /1 advisory.*→ PASS$/m);
});
check('a build that renders two headers at once fails even when the morph matches', () => {
  const r = cmp(obs(), obs({ header: { count: 2 } }));
  assert.equal(r.code, 1); assert.match(r.out, /^motion header count: EXTRA on build \(2 header elements rendered on build vs 1 on live/m); assert.match(r.out, /^motion header scroll-morph: parity/m);
});

// ---- CLI: tolerance boundary ------------------------------------------------------------------------
check('timing delta equal to the tolerance passes; one ms over fails; --tolerance-ms widens', () => {
  const at = cmp(obs(), obs({ widgets: [widget('.next', { transition: 'transform 0.55s ease 0s' })] }));
  assert.equal(at.code, 0, at.out); assert.match(at.out, /^motion widget \.next: parity/m);
  const over = cmp(obs(), obs({ widgets: [widget('.next', { transition: 'transform 551ms ease 0s' })] }));
  assert.equal(over.code, 1, over.out); assert.match(over.out, /^motion widget \.next: timing delta 151ms > 150ms \[transition: live 400ms, build 551ms\]/m); assert.match(over.out, /1 out of tolerance.*→ FAIL$/m);
  const widened = cmp(obs(), obs({ widgets: [widget('.next', { transition: 'transform 551ms ease 0s' })] }), '--tolerance-ms', '200');
  assert.equal(widened.code, 0, widened.out); assert.match(widened.out, /tolerance 200ms/);
});
check('magnitude delta equal to the px tolerance passes; one px over fails; settle-frame drift is a timing delta', () => {
  const at = cmp(obs(), obs({ header: { scrolledH: 118 } })); // Δheight 80 vs 72 → 8px = tolerance
  assert.equal(at.code, 0, at.out);
  const over = cmp(obs(), obs({ header: { scrolledH: 119 } }));
  assert.equal(over.code, 1, over.out); assert.match(over.out, /^motion header scroll-morph: magnitude delta 9px > 8px \[height change: live 80px, build 71px\]/m);
  const travel = cmp(obs(), obs({ widgets: [widget('.next', { travel: 300 })] }));
  assert.match(travel.out, /^motion widget \.next: magnitude delta 20px > 8px \[travel: live 320px, build 300px\]/m);
  const settle = cmp(obs(), obs({ widgets: [widget('.next', { settleAt: 3 })] }));
  assert.match(settle.out, /^motion widget \.next: timing delta 200ms > 150ms \[settle: live 400ms, build 600ms\]/m);
  const restore = cmp(obs(), obs({ header: { restoreAt: 200 } }));
  assert.match(restore.out, /magnitude delta 140px > 8px \[restore threshold: live y≤60, build y≤200\]/m);
  const header = cmp(obs(), obs({ header: { transition: 'height 0.3s ease 0s' } }));
  assert.match(header.out, /^motion header scroll-morph: timing delta 200ms > 150ms \[transition: live 500ms, build 300ms\]/m);
  const count = cmp(obs(), obs({ animations: anim('fadeIn', 2) }));
  assert.equal(count.code, 1); assert.match(count.out, /^motion entrance fadeIn: fired-element count live 3, build 2$/m);
  const hov = cmp(obs(), obs({ hovers: [hover('.card', ['self.color'])] }));
  assert.match(hov.out, /^motion hover \.card: build lacks span\.transform/m);
});

// ---- CLI: dead on live ----------------------------------------------------------------------------
check('dead-on-live behaviors are reported as not required and never fail — whatever the build side probed', () => {
  const live = obs({ header: { morph: false }, widgets: [widget('.tab', { travel: null }), widget('.gone', { error: 'not found' })], hovers: [hover('.card', []), hover('.nope', [], undefined, 'not found')], animations: [], transitions: [], classes: [] });
  const same = cmp(live, live);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /^motion header scroll-morph: dead on live — not required/m);
  assert.match(same.out, /^motion widget \.tab: dead on live — not required \(no sampled change across the frames/m);
  assert.match(same.out, /^motion widget \.gone: unobserved on live — not required \(live probe not found\)$/m);
  assert.match(same.out, /^motion hover \.card: dead on live — not required \(no measured hover diff\)$/m);
  assert.match(same.out, /^motion hover \.nope: unobserved on live — not required/m);
  assert.match(same.out, /5 dead on live \(not required\).*→ PASS$/m);
  // the build did not implement them (probe finds nothing / no change) — still parity
  const build = obs({ header: { morph: false }, widgets: [widget('.tab', { error: 'not found' })], hovers: [hover('.card', [], undefined, 'not found')], animations: [], transitions: [], classes: [] });
  assert.equal(cmp(live, build).code, 0, cmp(live, build).out);
});

// ---- CLI: pairing, json, width warning -------------------------------------------------------------
check('re-authored selectors pair by order and say so; a build-only probe with no change is not required', () => {
  const r = cmp(obs({ widgets: [widget('.src-next')], hovers: [hover('.src-card')] }), obs({ widgets: [widget('.build-next'), widget('.build-only', { travel: null })], hovers: [hover('.build-card')] }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^motion widget \.src-next → \.build-next: parity \(.*; paired by order\)$/m);
  assert.match(r.out, /^motion hover \.src-card → \.build-card: parity \(.*; paired by order\)$/m);
  assert.match(r.out, /^motion widget \.build-only: unobserved on live — not required/m);
});
check('--json writes the verdicts and counts; differing widths warn on stderr', () => {
  const out = join(dir, 'sub', 'summary.json');
  const r = cmp(obs(), obs({ width: 390, animations: [] }), '--json', out);
  assert.equal(r.code, 1); assert.match(r.err, /WARNING: viewport widths differ \(live 1440, build 390\)/);
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.pass, false); assert.equal(j.counts.missing, 1); assert.equal(j.toleranceMs, 150);
  assert.ok(j.verdicts.some((v) => v.cls === 'entrance' && v.state === 'missing' && /MISSING on build/.test(v.line)));
});

// ---- CLI: bad input ------------------------------------------------------------------------------------
check('usage and unreadable input exit 2 with a reason', () => {
  assert.equal(run().code, 2); assert.match(run().err, /need <live\.json> and <build\.json>/);
  assert.equal(run(save(obs())).code, 2);
  const missing = run(join(dir, 'nope.json'), save(obs())); assert.equal(missing.code, 2); assert.match(missing.err, /cannot read live/);
  const garbage = run(save(obs()), save('{not json')); assert.equal(garbage.code, 2); assert.match(garbage.err, /cannot read build/);
  const shape = run(save(obs()), save({ url: 'x', width: 1 })); assert.equal(shape.code, 2); assert.match(shape.err, /lacks motion-observe keys: headerTimeline, widgetSamples, hoverSamples, events/);
  assert.equal(run(save([]), save(obs())).code, 2);
  const flag = cmp(obs(), obs(), '--bogus'); assert.equal(flag.code, 2); assert.match(flag.err, /unknown flag --bogus/);
  assert.equal(cmp(obs(), obs(), '--tolerance-ms', 'abc').code, 2);
  assert.equal(cmp(obs(), obs(), '--json').code, 2);
  assert.equal(run('--help').code, 0); assert.match(run('--help').out, /Usage: node motion-compare\.mjs/);
});

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nmotion-compare: all checks passed');
process.exit(failed ? 1 : 0);
