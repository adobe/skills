#!/usr/bin/env node
// skills/diff/scripts/test/unit-geometry.test.mjs — the unit-geometry.mjs alignment (#125 D3), no browser:
// keyed() stable keys (role:text, role:selector#ordinal, #2 for duplicates), alignUnit pairs by key, by text
// prefix, across relaxed roles (link ↔ button), images by order whatever their alt, leftover text by position
// (the session-variable badge), reports Δx/Δy/Δw/Δh relative to the unit, flags off / hidden / missing / extra
// and the unit size; verdictOf totals; parseArgs; --help in an empty cwd. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignUnit, compareUnits, formatUnits, keyed, parseArgs, verdictOf } from '../unit-geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'unit-geometry.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const el = (role, text, x, y, w, h, extra = {}) => ({ role, tag: role === 'image' ? 'img' : 'p', sel: role === 'image' ? 'img' : 'p.x', text, x, y, w, h, fs: 16, lh: 22, fw: '400', ...extra });

check('keyed: role:text keys, selector#ordinal for text-less, #2 for duplicates', () => {
  const k = keyed([el('text', 'Expires', 0, 0, 10, 10), el('image', '', 0, 0, 10, 10), el('image', '', 0, 0, 10, 10), el('text', 'Expires', 0, 0, 10, 10)]);
  assert.deepEqual(k.map((x) => x.key), ['text:expires', 'image:img#1', 'image:img#2', 'text:expires #2']);
});
check('alignUnit: the recorded card — body 28 px low, details link hidden, badge paired by position, image by order', () => {
  const o = { rect: { x: 165, y: 500, w: 350, h: 260 }, elements: [el('text', '1 day left', -10, -10, 70, 70), el('image', '', 17, 76, 70, 70), el('text', 'Expires 09/26/26', 112, 12, 202, 15), el('text', 'Earn $5 W Cash rewards when you spend', 112, 27, 202, 54), el('link', 'View details', 112, 176, 91, 24), el('button', 'Clip', 12, 204, 326, 44)] };
  const e = { rect: { x: 165, y: 522, w: 355, h: 238 }, elements: [el('text', '2 days left', -27, -30, 64, 64), el('image', 'coupon', 11, 46, 65, 65), el('text', 'Expires 09/26/26', 101, 16, 242, 20), el('text', 'Earn $5 W Cash rewards when yo…', 101, 55, 215, 48), el('link', 'View details', 101, 204, 91, 20, { hidden: true }), el('link', 'Clip', 12, 182, 331, 44)] };
  const r = alignUnit(o, e, 4);
  assert.equal(r.summary.missing, 0, JSON.stringify(r.missing)); assert.equal(r.summary.extra, 0);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by['text:1 day left'].byPosition, true); assert.equal(by['text:1 day left'].dy, -20);
  assert.equal(by['image:img#1'].dy, -30);
  assert.equal(by['text:earn $5 w cash rewards when you spend'].dy, 28, 'prefix-matched summary line is 28 px low');
  assert.equal(by['link:view details'].hidden, true); assert.equal(by['link:view details'].dy, 28);
  assert.equal(by['button:clip'].eds.role, 'link', 'relaxed role pairing'); assert.equal(by['button:clip'].dy, -22);
  assert.equal(r.unit.dh, -22); assert.equal(r.summary.unitOff, true);
  assert.equal(r.summary.within, 0); assert.equal(r.summary.hidden, 1);
});
check('alignUnit: identical units read all within, nothing off', () => {
  const u = { rect: { x: 0, y: 0, w: 100, h: 100 }, elements: [el('heading', 'Title', 0, 0, 100, 20), el('text', 'Body', 0, 30, 100, 20)] };
  const r = alignUnit(u, { ...u, rect: { x: 300, y: 0, w: 100, h: 100 } }, 4);
  assert.equal(r.summary.within, 2); assert.equal(r.summary.off, 0); assert.equal(r.unit.dx, 300); assert.equal(r.summary.unitOff, false);
});
check('missing + extra when nothing pairs; verdictOf totals; formatUnits marks rows', () => {
  const o = { rect: { x: 0, y: 0, w: 10, h: 10 }, elements: [el('link', 'Only here', 0, 0, 10, 10)] };
  const e = { rect: { x: 0, y: 0, w: 10, h: 10 }, elements: [el('button', 'Something else', 0, 0, 10, 10)] };
  const r = alignUnit(o, e, 4);
  assert.equal(r.summary.missing, 1); assert.equal(r.summary.extra, 1);
  const res = [{ sel: 'a=b', units: [{ index: 0, ...r }] }, { sel: 'x=y', units: [], error: 'no visible unit' }];
  assert.deepEqual(verdictOf(res), { units: 1, within: 0, off: 0, hidden: 0, missing: 1, errors: 1 });
  const s = formatUnits(res, 4); assert.match(s, /✗ missing/); assert.match(s, /🟡 extra/); assert.match(s, /no visible unit/);
});
check('compareUnits pairs units by index and reports a side without visible units', () => {
  const inv = (n) => ({ bySel: { '.c': { matches: n, units: Array.from({ length: n }, (_, i) => ({ index: i, path: 'div', rect: { x: 0, y: i * 100, w: 10, h: 10 }, elements: [] })) } } });
  assert.equal(compareUnits(inv(2), inv(2), { origin: '.c', eds: '.c' }, 4).units.length, 2);
  assert.match(compareUnits(inv(2), inv(0), { origin: '.c', eds: '.c' }, 4).error, /served side/);
});
check('parseArgs: repeatable --unit with and without the served selector', () => {
  const o = parseArgs(['node', 'x', 'https://o/', 'https://e/', '--unit', '.a=.b', '--unit', '.c', '--n', '3', '--tol', '2', '--slug', 's']);
  assert.deepEqual(o.units, [{ origin: '.a', eds: '.b' }, { origin: '.c', eds: '.c' }]); assert.equal(o.n, 3); assert.equal(o.tol, 2); assert.equal(o.slug, 's');
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'unit-geometry-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node unit-geometry\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
