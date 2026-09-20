#!/usr/bin/env node
// Fixture test: lib.mjs driveControl — the one helper behind the dynamics-check `click-control` type and
// deploy qa-gate's control pass (T20.2 PR B). No browser: a scripted fake page queues the in-page snapshots.
//   * a changed observable → { changed: true, by, before, after }; unchanged → changed false naming nothing
//     (the dead chevron); `expect` compares the after-value; `observe` absent → the first observable that moved;
//   * driveControl never clicks a skipped control (disabled / zero-box) or an absent one, and clicks exactly once otherwise;
//   * dynamics-check.mjs header lists click-control, RUNNERS carries the type ONCE and goes through the helper;
//     parity-report.md names the type in the closed set.
// Before the change no control drive existed in dynamics: a chevron that advanced nothing passed as "rendered".
// Usage: node plugins/stardust/skills/dynamics/scripts/test/drive-control.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driveControl, CONTROL_OBSERVABLES } from '../lib.mjs';

// a scripted page: evaluate(snapshotFn, { sel, observeSel }) → the next queued snapshot; evaluate(clickFn, sel) → a counted click
const snap = (o = {}) => ({ label: 'button.menu', block: 'header', disabled: false, box: true, 'aria-expanded': null, 'aria-selected': null, 'aria-current': null, hidden: null, open: null, scrollLeft: null, transform: null, class: 'header', visible: null, ...o });
const fakePage = (readings) => { const clicks = []; return { clicks, evaluate: async (fn, arg) => { if (typeof arg === 'string') { clicks.push(arg); return undefined; } return readings.shift(); }, waitForTimeout: async () => {} }; };

let pg = fakePage([snap({ 'aria-expanded': 'false' }), snap({ 'aria-expanded': 'true' })]);
let r = await driveControl(pg, 'button.menu', { observe: 'aria-expanded', settleMs: 1 });
assert.deepEqual([r.found, r.changed, r.by, r.before, r.after], [true, true, 'aria-expanded', 'false', 'true']);
assert.deepEqual(pg.clicks, ['button.menu'], 'exactly one click');

pg = fakePage([snap({ scrollLeft: 0 }), snap({ scrollLeft: 0 })]);
r = await driveControl(pg, '.cards .next', { observe: 'scrollLeft', settleMs: 1 });
assert.equal(r.changed, false, 'dead chevron: nothing moved → not changed'); assert.equal(r.by, null); assert.equal(pg.clicks.length, 1);

pg = fakePage([snap({ 'aria-selected': 'false' }), snap({ 'aria-selected': 'true' })]);
r = await driveControl(pg, '.tabs button', { observe: 'aria-selected', expect: 'false', settleMs: 1 });
assert.equal(r.changed, false, '`expect` compares the after-value'); assert.equal(r.by, 'aria-selected');

pg = fakePage([snap({ hidden: true }), snap({ hidden: false })]);
r = await driveControl(pg, 'button.acc', { settleMs: 1 });
assert.deepEqual([r.changed, r.by], [true, 'hidden'], 'no observe → the first observable that moved');

pg = fakePage([snap({ visible: false }), snap({ visible: true })]);
r = await driveControl(pg, '.search-toggle', { observe: 'visible:.search-box', settleMs: 1 });
assert.deepEqual([r.changed, r.by, r.before, r.after], [true, 'visible', false, true]);

pg = fakePage([snap({ disabled: true })]);
r = await driveControl(pg, 'button.next', { observe: 'scrollLeft', settleMs: 1 });
assert.deepEqual([r.found, r.skipped], [true, 'disabled']); assert.deepEqual(pg.clicks, [], 'a disabled control is never clicked');
pg = fakePage([snap({ box: false })]);
r = await driveControl(pg, 'button.next', { observe: 'scrollLeft', settleMs: 1 });
assert.equal(r.skipped, 'zero-box'); assert.deepEqual(pg.clicks, [], 'a zero-box control is never clicked');
pg = fakePage([null]);
r = await driveControl(pg, 'button.gone', { observe: 'aria-expanded', settleMs: 1 });
assert.equal(r.found, false); assert.deepEqual(pg.clicks, [], 'an absent control is never clicked');
assert.ok(CONTROL_OBSERVABLES.includes('scrollLeft') && CONTROL_OBSERVABLES.includes('visible'));

// --- dynamics-check wiring: header row + one runner through the helper
const src = readFileSync(join(import.meta.dirname, '..', 'dynamics-check.mjs'), 'utf8');
assert.match(src, /\* {3}click-control {2}\{ path\*, trigger\*, observe\*: scrollLeft\|aria-expanded\|aria-selected\|hidden\|open\|class\|visible:<sel>, expect\? \}/, 'header lists the check shape');
assert.equal((src.match(/async 'click-control'\(c, \{ ctx, origin \}\)/g) || []).length, 1, 'RUNNERS carries the type exactly once');
assert.match(src, /driveControl\(page, c\.trigger, \{ observe: c\.observe, expect: c\.expect \}\)/, 'the runner goes through the shared helper');
assert.match(src, /pageerror\(s\) during the drive/, 'a pageerror during the drive is a FAIL naming the reason');
const doc = readFileSync(join(import.meta.dirname, '..', '..', 'reference', 'parity-report.md'), 'utf8');
assert.match(doc, /`click-control` \(`\{ path, trigger, observe,\s*expect\? \}`/, 'parity-report.md names the type in the closed set');
console.log('drive-control test: ok (changed/by/expect verdicts, no-observe auto-detect, visible:<sel>, one click, disabled/zero-box/absent never clicked, dynamics-check header + single runner + pageerror FAIL + parity-report wired)');
