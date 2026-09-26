#!/usr/bin/env node
// skills/diff/scripts/test/content-presence.test.mjs — the content-presence.mjs differ (#125 D2), no browser:
// alignHeadings (LCS by text, prefix tolerance), diffPresence — HIDDEN LINK ×n for links present but clipped,
// MISSING LINK for absent ones, MOVED LINK when present in another band, cross-kind matching (an origin
// button served as a link is not missing), session-variable regions compared as counts (never MISSING) while
// HIDDEN still counts, CONTROL STATE for a sort trigger, HEADING AS TEXT when the text survives as plain
// text, scope = whole page when one side lacks <main>, chrome items excluded by default; formatReport lines;
// --help in an empty cwd. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignHeadings, diffPresence, formatReport } from '../content-presence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'content-presence.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const it = (kind, text, y, extra = {}) => ({ kind, text, y, x: 0, w: 100, h: 20, state: 'visible', variable: false, inRoot: true, inChrome: false, path: 'p', ...extra });
const inv = (items, root = 'main') => ({ docH: 3000, pageW: 1440, root, items });

check('alignHeadings: LCS in order, prefix-tolerant for long texts', () => {
  assert.deepEqual(alignHeadings(['a', 'b', 'c'], ['a', 'c']), [{ oi: 0, ei: 1 }, { oi: 2, ei: 1 }].map((p, i) => [{ oi: 0, ei: 0 }, { oi: 2, ei: 1 }][i]));
  assert.deepEqual(alignHeadings(['help center topics'], ['help center topics and more']), [{ oi: 0, ei: 0 }]);
  assert.deepEqual(alignHeadings(['x'], ['y']), []);
});
check('HIDDEN LINK ×n when the served links exist but are clipped; exit criterion counts them', () => {
  const o = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d' }))]);
  const e = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d', state: 'hidden' }))]);
  const r = diffPresence(o, e);
  const f = r.findings.find((x) => x.kind === 'HIDDEN LINK');
  assert.ok(f && f.n === 3, JSON.stringify(r.findings)); assert.equal(r.totals.hidden, 3); assert.equal(r.totals.missing, 0); assert.equal(r.bands[1].eds.linkHidden, 3);
});
check('MISSING LINK when absent, MOVED LINK when visible in another band, EXTRA LINK for build-only', () => {
  const o = inv([it('heading', 'A', 100, { level: 2 }), it('link', 'Contact', 150, { href: '/c' }), it('heading', 'B', 500, { level: 2 }), it('link', 'Careers', 550, { href: '/j' })]);
  const e = inv([it('heading', 'A', 100, { level: 2 }), it('heading', 'B', 500, { level: 2 }), it('link', 'Contact', 550, { href: '/c' }), it('link', 'Newsroom', 560, { href: '/n' })]);
  const r = diffPresence(o, e);
  assert.deepEqual(r.findings.map((x) => x.kind).sort(), ['EXTRA LINK', 'MISSING LINK', 'MOVED LINK']);
  assert.equal(r.totals.missing, 1);
});
check('cross-kind: an origin button served as a link is present; an origin link served as a button is present', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('button', 'Sign in', 20), it('link', 'Join', 30, { href: '/j' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'Sign in', 20, { href: '/s' }), it('button', 'Join', 30)]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});
check('session-variable region: counts only (never MISSING), HIDDEN still 🔴', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 6 }, (_, i) => it('link', `Coupon ${i}`, 100 + i, { href: '/c', variable: true }))]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 2 }, (_, i) => it('link', `Other ${i}`, 100 + i, { href: '/o', variable: true })), it('link', 'Clipped one', 120, { href: '/x', variable: true, state: 'hidden' })]);
  const r = diffPresence(o, e);
  assert.ok(!r.findings.some((x) => x.kind === 'MISSING LINK'), JSON.stringify(r.findings));
  assert.ok(r.findings.some((x) => x.kind === 'COUNT LINKS'));
  assert.equal(r.totals.hidden, 1); assert.equal(r.bands[1].variable, true);
});
check('CONTROL STATE for a trigger with the same label and a different value; COUNT control matched by via', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Recommended', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '285', via: 'count' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Expiration Date', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '284', via: 'count' })]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.filter((x) => x.kind === 'CONTROL STATE').length, 2, JSON.stringify(r.findings)); assert.equal(r.totals.controlState, 2); assert.equal(r.totals.structural, 0);
});
check('a specifically labelled control with no counterpart is CONTROL MISSING (never paired by ordinal); generic ones pair by ordinal', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'rebate help', value: 'rebate help', via: 'trigger' }), it('control', '', 25, { label: 'trigger', value: 'Menu A', via: 'trigger' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'trigger', value: 'Menu B', via: 'trigger' })]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL MISSING' && /rebate/.test(x.msg)));
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL STATE' && /Menu A.*Menu B/.test(x.msg)));
});
check('HEADING AS TEXT (🟡) when the text is served as plain text; MISSING HEADING (🔴) when it is gone', () => {
  const o = inv([it('heading', 'Rx information', 100, { level: 3 }), it('heading', 'Gone', 300, { level: 2 })]);
  const e = inv([it('text', 'Rx information', 100)]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'HEADING AS TEXT' && x.sev === '🟡'));
  assert.ok(r.findings.some((x) => x.kind === 'MISSING HEADING' && x.sev === '🔴')); assert.equal(r.totals.missingHeadings, 1);
});
check('scope: whole page when one side has no root; chrome items excluded unless { chrome: true }', () => {
  const o = inv([it('link', 'Promo strip', 5, { href: '/p', inRoot: null, inChrome: true }), it('link', 'Body link', 400, { href: '/b', inRoot: null })], null);
  const e = inv([it('link', 'Body link', 400, { href: '/b', inRoot: true })], 'main');
  assert.equal(diffPresence(o, e).scope, 'page');
  assert.equal(diffPresence(o, e).findings.length, 0);
  assert.equal(diffPresence(o, e, { chrome: true }).totals.missing, 1);
});
check('formatReport: band table + Content/Findings lines', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'A', 20, { href: '/a' })]);
  const r = diffPresence(o, inv([it('heading', 'H', 10, { level: 1 })]));
  const s = formatReport(r);
  assert.match(s, /\| band \| heading/); assert.match(s, /MISSING LINK: "A"/); assert.match(s, /Content: MISSING 1/); assert.match(s, /Findings: 1 \(1 structural/);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'content-presence-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node content-presence\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
