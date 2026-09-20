#!/usr/bin/env node
// Fixture test: lib.mjs driveControl / observableChanged / readObservable — the one helper behind the
// dynamics-check `click-control` type (T20.2 PR B). No browser: a scripted fake page and a fake DOM.
//   * observableChanged: changed → pass, unchanged → FAIL naming the observable, `expect` compares the
//     after-value, a skipped reading → pass null with the reason (never a silent pass);
//   * driveControl never clicks a skipped control (disabled / zero-box / absent) and clicks exactly once otherwise;
//   * readObservable (fake document): disabled and zero-box triggers are SKIPPED, aria-* read the trigger,
//     `hidden` follows aria-controls;
//   * dynamics-check.mjs header lists click-control and its RUNNERS entry exists (replay wiring).
// Before the change no control drive existed in dynamics: a chevron that advanced nothing passed as "rendered".
// Usage: node plugins/stardust/skills/dynamics/scripts/test/drive-control.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driveControl, observableChanged, readObservable, CONTROL_OBSERVABLES } from '../lib.mjs';

// --- observableChanged (pure)
assert.deepEqual(observableChanged({ value: 'false' }, { value: 'true' }, { observe: 'aria-expanded' }), { pass: true, detail: 'aria-expanded: false → true' });
const same = observableChanged({ value: '0' }, { value: '0' }, { observe: 'scrollLeft' });
assert.equal(same.pass, false); assert.match(same.detail, /scrollLeft unchanged \(0\) — no observable changed/);
assert.equal(observableChanged({ value: 'hidden' }, { value: 'visible' }, { observe: 'visible:.search', expect: 'visible' }).pass, true);
const miss = observableChanged({ value: 'false' }, { value: 'false' }, { observe: 'aria-selected', expect: 'true' });
assert.equal(miss.pass, false); assert.match(miss.detail, /expected true/);
const skip = observableChanged({ skipped: 'disabled' }, { skipped: 'disabled' }, { observe: 'aria-expanded' });
assert.equal(skip.pass, null); assert.equal(skip.skipped, 'disabled'); assert.match(skip.detail, /^SKIP aria-expanded: disabled/);
assert.equal(observableChanged({ value: '3' }, { skipped: 'zero-box' }, { observe: 'scrollLeft' }).pass, true, 'a control that vanishes after the click changed something');

// --- driveControl over a scripted page: readings are queued, clicks are counted
const fakePage = (readings) => { const clicks = []; return { clicks, evaluate: async () => readings.shift(), click: async (sel) => { clicks.push(sel); } }; };
let pg = fakePage([{ value: 'false' }, { value: 'true' }]);
let r = await driveControl(pg, 'button.menu', { observe: 'aria-expanded', settleMs: 1 });
assert.equal(r.pass, true); assert.deepEqual(pg.clicks, ['button.menu'], 'exactly one click');
pg = fakePage([{ skipped: 'disabled' }]);
r = await driveControl(pg, 'button.next', { observe: 'scrollLeft', settleMs: 1 });
assert.equal(r.pass, null); assert.deepEqual(pg.clicks, [], 'a skipped control is never clicked');
pg = fakePage([{ value: '0' }, { value: '0' }]);
r = await driveControl(pg, '.dots button:nth-child(2)', { observe: 'scrollLeft', settleMs: 1 });
assert.equal(r.pass, false, 'dead chevron: nothing moved → FAIL'); assert.equal(pg.clicks.length, 1);

// --- readObservable over a fake DOM (the in-page reader; globals stubbed for the test only)
const el = (attrs = {}, box = { width: 40, height: 40 }, extra = {}) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, getBoundingClientRect: () => box, closest: () => null, className: '', ...extra });
const withDom = (nodes, fn) => { const prev = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle }; globalThis.document = { querySelector: (s) => nodes[s] || null, getElementById: (id) => nodes[`#${id}`] || null, body: { querySelector: () => null, scrollLeft: 0 } }; globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', overflowX: 'visible' }); try { return fn(); } finally { globalThis.document = prev.document; globalThis.getComputedStyle = prev.getComputedStyle; } };
withDom({ 'button.menu': el({ 'aria-expanded': 'false' }) }, () => assert.deepEqual(readObservable({ trigger: 'button.menu', observe: 'aria-expanded' }), { value: 'false' }));
withDom({ 'button.menu': el({ 'aria-disabled': 'true', 'aria-expanded': 'false' }) }, () => assert.deepEqual(readObservable({ trigger: 'button.menu', observe: 'aria-expanded' }), { skipped: 'disabled' }));
withDom({ 'button.menu': el({}, { width: 40, height: 40 }, { disabled: true }) }, () => assert.deepEqual(readObservable({ trigger: 'button.menu', observe: 'aria-expanded' }), { skipped: 'disabled' }));
withDom({ 'button.next': el({}, { width: 0, height: 0 }) }, () => assert.deepEqual(readObservable({ trigger: 'button.next', observe: 'scrollLeft' }), { skipped: 'zero-box' }));
withDom({}, () => assert.deepEqual(readObservable({ trigger: 'button.gone', observe: 'aria-expanded' }), { skipped: 'trigger not found' }));
withDom({ 'button.acc': el({ 'aria-controls': 'panel' }), '#panel': { hidden: true } }, () => assert.deepEqual(readObservable({ trigger: 'button.acc', observe: 'hidden' }), { value: 'true' }));
withDom({ '.search-toggle': el({}), '.search-box': el({}, { width: 0, height: 0 }) }, () => assert.deepEqual(readObservable({ trigger: '.search-toggle', observe: 'visible:.search-box' }), { value: 'hidden' }));
assert.ok(CONTROL_OBSERVABLES.includes('scrollLeft') && CONTROL_OBSERVABLES.includes('visible:<sel>'));

// --- dynamics-check wiring: header row + runner
const src = readFileSync(join(import.meta.dirname, '..', 'dynamics-check.mjs'), 'utf8');
assert.match(src, /\* {3}click-control {2}\{ path\*, trigger\*, observe\*: scrollLeft\|aria-expanded\|aria-selected\|hidden\|open\|class\|visible:<sel>, expect\? \}/, 'header lists the check shape');
assert.match(src, /async 'click-control'\(c, \{ ctx, origin \}\)/, 'RUNNERS carries the type');
assert.match(src, /driveControl\(page, c\.trigger, \{ observe: c\.observe, expect: c\.expect \}\)/, 'the runner goes through the shared helper');
const doc = readFileSync(join(import.meta.dirname, '..', '..', 'reference', 'parity-report.md'), 'utf8');
assert.match(doc, /`click-control` \(`\{ path, trigger, observe,\s*expect\? \}`/, 'parity-report.md names the type in the closed set');
console.log('drive-control test: ok (observableChanged verdicts + skip, driveControl clicks once and never a skipped control, readObservable skips disabled/zero-box/absent, dynamics-check header + runner + parity-report wired)');
