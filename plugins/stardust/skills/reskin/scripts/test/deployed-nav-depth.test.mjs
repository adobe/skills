#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-nav-depth.test.mjs — deployed-gate.mjs's nav-depth row of parity: the source
// header's nav groups held to the delivered header's dropdowns, from hand-built navTree trees (the shape navTree reads in
// the page). Then runNavDepth with a stand-in measure, and `all` with stand-in steps: the row is blocking and the ledger
// fragment carries it as chrome.navDepth. No browser, no network.
// Run: node <this file>.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, navDepthLedger, navDepthRow, navGroups, runNavDepth } from '../deployed-gate.mjs';
import { deployedDir } from '../deployed/io.mjs';

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e?.stack ?? e).split('\n').slice(0, 8).join('\n  ')}`); }
}
const scratch = mkdtempSync(join(tmpdir(), 'deployed-nav-depth-'));

// navTree nodes: { t, cls, role, label, shown, expanded, links, trig, kids }.
const node = (t, kids = [], over = {}) => ({ t, cls: '', role: null, label: null, shown: true, expanded: null, links: kids.reduce((n, k) => n + k.links, 0), trig: null, kids, ...over });
const a = () => node('a', [], { links: 1 });
const links = (n) => Array.from({ length: n }, a);
const list = (items, over = {}) => node('ul', items, over);
const item = (label, kids = [a()], over = {}) => node('li', kids, { label, ...over });
// A source header: a nav list whose first `groups` items own a submenu of three links, then plain links.
const sourceHeader = (groups, plain = 2) => node('header', [node('nav', [list([
  ...Array.from({ length: groups }, (_, i) => item(`Group ${i + 1}`, [a(), list([item('x'), item('y'), item('z')], { shown: false })])),
  ...Array.from({ length: plain }, (_, i) => item(`Link ${i + 1}`)),
])])]);
// The EDS boilerplate header: .nav-sections > .default-content-wrapper > ul > li(.nav-drop > ul).
const edsHeader = (sections) => node('header', [node('nav', [node('div', [node('div', [list(sections)], { cls: 'default-content-wrapper' })], { cls: 'nav-sections' })], { expanded: 'true' })]);
const drop = (label, { expanded = 'false', shown = false } = {}) => item(label, [list([item('x'), item('y'), item('z')], { shown })], { cls: 'nav-drop', expanded });

await check('source with 3 nav groups, delivered flat (all 16 links in one list): FAIL naming both counts and the flat list', () => {
  const flat = edsHeader(Array.from({ length: 16 }, (_, i) => item(`Link ${i + 1}`)));
  const r = navDepthRow({ source: sourceHeader(3), delivered: flat });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.value, 'source 3 nav groups, delivered 0');
  assert.match(r.detail, /source header has 3 nav groups \(Group 1, Group 2, Group 3\), the delivered header 0: a flat list of the group links does not satisfy it/);
  assert.equal(navDepthLedger(r), 'FAIL source 3 nav groups, delivered 0');
});

await check('fewer delivered dropdowns than source groups is a FAIL; the same label twice (desktop and mobile copy) counts once', () => {
  const source = node('header', [sourceHeader(3), sourceHeader(3)]);
  assert.equal(navGroups(source).count, 3);
  const r = navDepthRow({ source, delivered: edsHeader([drop('Group 1'), drop('Group 2'), item('Group 3')]) });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.value, 'source 3 nav groups, delivered 2');
});

await check('delivered with 3 closed dropdowns (aria-expanded="false", submenu hidden): PASS; groups outside .nav-sections are not counted', () => {
  const delivered = edsHeader([drop('Group 1'), drop('Group 2'), drop('Group 3'), item('Contact')]);
  delivered.kids.push(node('div', [list([drop('Tools'), drop('More')])], { cls: 'nav-tools' }));
  assert.deepEqual(navGroups(delivered, { eds: true }).labels, ['Group 1', 'Group 2', 'Group 3']);
  const r = navDepthRow({ source: sourceHeader(3), delivered });
  assert.equal(r.status, 'PASS', r.detail);
  assert.equal(r.value, 'source 3 nav groups, delivered 3');
  assert.equal(navDepthLedger(r), 'PASS');
});

await check('a dropdown open at load (aria-expanded="true", or its submenu shown) is a FAIL even when the counts match', () => {
  for (const open of [{ expanded: 'true' }, { shown: true }]) {
    const r = navDepthRow({ source: sourceHeader(3), delivered: edsHeader([drop('Group 1', open), drop('Group 2'), drop('Group 3')]) });
    assert.equal(r.status, 'FAIL', JSON.stringify(open));
    assert.equal(r.value, 'source 3 nav groups, delivered 3, 1 open at load');
    assert.match(r.detail, /1 dropdown\(s\) open at load @1440 \(Group 1\): a dropdown is closed by default/);
  }
});

await check('source with no nav groups (or no header) is n/a, whatever the delivered header is', () => {
  assert.deepEqual([navDepthRow({ source: sourceHeader(0, 6), delivered: null }).status, navDepthRow({ source: sourceHeader(0, 6), delivered: null }).value], ['n/a', 'n/a: the source header has no nav groups']);
  assert.equal(navDepthRow({ source: null, delivered: edsHeader([]) }).value, 'n/a: the source page has no header');
  assert.equal(navDepthLedger(navDepthRow({ source: sourceHeader(0) })), 'n/a: the source header has no nav groups');
});

await check('header rows: fewer delivered rows than the source (a utility bar merged into the menu) is a FAIL, even with no nav groups', () => {
  const tiered = (tree, tiers) => ({ ...tree, tiers });
  const lost = navDepthRow({ source: tiered(sourceHeader(0, 6), 2), delivered: tiered(edsHeader([item('A')]), 1) });
  assert.equal(lost.status, 'FAIL');
  assert.equal(lost.value, 'source 0 nav groups, delivered 0; rows 2 → 1');
  assert.match(lost.detail, /source header has 2 rows, the delivered header 1: each source row \(a utility bar above the logo row\) stays its own row/);
  assert.equal(navDepthRow({ source: tiered(sourceHeader(3), 2), delivered: tiered(edsHeader([drop('Group 1'), drop('Group 2'), drop('Group 3')]), 2) }).status, 'PASS');
  assert.equal(navDepthRow({ source: tiered(sourceHeader(0, 6), 1), delivered: tiered(edsHeader([]), 1) }).status, 'n/a');
});

await check('a disclosure button (aria-controls) with a panel of links is a group; a "Menu" or "Search" toggle is not', () => {
  const button = (label, n, over = {}) => node('button', [], { label, trig: { links: n, nested: false, shown: false }, expanded: 'false', ...over });
  const source = node('header', [node('div', [button('Products', 4), button('Company', 3), button('Menu', 12), button('Search', 2), button('Solo', 1)])]);
  assert.deepEqual(navGroups(source).labels, ['Products', 'Company']);
  assert.equal(navDepthRow({ source, delivered: edsHeader([drop('Products'), drop('Company')]) }).status, 'PASS');
});

await check('runNavDepth: measures the content model\'s _provenance.url against the preview, writes nav-depth.json; no content model is n/a; a measure error is ERROR; a bot challenge throws code 3', async () => {
  const dir = join(scratch, 'run', 'stardust');
  const preview = { url: 'http://127.0.0.1:9/ns/home' };
  const none = await runNavDepth({ dir, slug: 'home', preview, measure: () => assert.fail('no source: nothing measured') });
  assert.equal(none.value, 'n/a: no content model _provenance.url: the source page is unknown');
  mkdirSync(join(dir, 'reskin', 'content-model', 'home'), { recursive: true });
  mkdirSync(deployedDir(dir, 'home'), { recursive: true });
  writeFileSync(join(dir, 'reskin', 'content-model', 'home', 'content-model.json'), JSON.stringify({ _provenance: { url: 'https://src.test/' } }));
  const seen = [];
  const r = await runNavDepth({ dir, slug: 'home', preview, measure: (urls) => { seen.push(urls); return { source: sourceHeader(3), delivered: edsHeader([item('A'), item('B')]) }; } });
  assert.deepEqual(seen, [{ sourceUrl: 'https://src.test/', previewUrl: preview.url }]);
  assert.equal(r.status, 'FAIL');
  const rec = JSON.parse(readFileSync(join(deployedDir(dir, 'home'), 'nav-depth.json'), 'utf8'));
  assert.deepEqual([rec.row.status, rec.source.count, rec.delivered.count], ['FAIL', 3, 0]);
  const err = await runNavDepth({ dir, slug: 'home', preview, measure: () => { throw new Error('HTTP 500 at x\nstack'); } });
  assert.deepEqual([err.status, navDepthLedger(err)], ['ERROR', 'ERROR (exit 124): HTTP 500 at x']);
  await assert.rejects(runNavDepth({ dir, slug: 'home', preview, measure: () => { throw Object.assign(new Error('challenge'), { name: 'BotChallengeError' }); } }), (e) => e.code === 3);
});

await check('all: a flat delivered nav fails parity (exit 1) and the ledger fragment says chrome.navDepth "FAIL …"; n/a leaves parity PASS', async () => {
  const run = async (name, nav) => {
    const dir = join(scratch, name, 'stardust');
    mkdirSync(deployedDir(dir, 'home'), { recursive: true });
    writeFileSync(join(deployedDir(dir, 'home'), 'preview.json'), JSON.stringify({ url: 'http://127.0.0.1:9/ns/home', origin: 'http://127.0.0.1:9', path: '/ns/home', namespace: 'ns', sandbox: false, checkedAt: new Date().toISOString() }));
    const pass = (c) => ({ check: c, width: 1440, value: '0', bar: '≤ 4px', status: 'PASS', artifact: null, detail: null });
    const runners = {
      content: () => ({ verdict: 'PASS', unusedDeltas: [], gates: [{ name: 'dom-equality', exit: 0, report: 'x.md', advisory: false, lines: [] }] }),
      tokens: () => ({ verdict: 'PASS', exit: 0, total: 1, failures: [], skipped: [] }),
      parity: () => ({ verdict: 'PASS', exit: 0, rows: [pass('pixel')] }),
      sanity: () => ({ verdict: 'PASS', exit: 0, hard: true, rows: [pass('overflow')] }),
      inherited: () => ({ verdict: 'PASS', exit: 0, rows: [pass('.plain.html')] }),
      navDepth: () => nav,
    };
    const lines = [];
    const code = await main(['all', '--page', 'home', '--dir', dir], { env: {}, log: (m) => lines.push(m), runners });
    return { code, lines, s: JSON.parse(readFileSync(join(deployedDir(dir, 'home'), 'summary.json'), 'utf8')) };
  };
  const flat = await run('all-flat', navDepthRow({ source: sourceHeader(3), delivered: edsHeader([item('A')]) }));
  assert.equal(flat.code, 1);
  assert.deepEqual([flat.s.ledgerFragment.parity, flat.s.ledgerFragment.chrome], ['FAIL 1/2', { navDepth: 'FAIL source 3 nav groups, delivered 0' }]);
  assert.ok(flat.lines.some((l) => /^ {2}nav-depth @1440: source 3 nav groups, delivered 0 \(bar /.test(l)), flat.lines.join('\n'));
  const none = await run('all-none', navDepthRow({ source: sourceHeader(0) }));
  assert.equal(none.code, 0);
  assert.deepEqual([none.s.ledgerFragment.parity, none.s.ledgerFragment.chrome], ['PASS', { navDepth: 'n/a: the source header has no nav groups' }]);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
