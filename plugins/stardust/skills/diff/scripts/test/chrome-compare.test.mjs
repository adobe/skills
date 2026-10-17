#!/usr/bin/env node
// skills/diff/scripts/test/chrome-compare.test.mjs — the header-parity verdict from two chrome-explore records (no browser):
// pairing by name then family, a hover menu rebuilt as click-only, missing panel links, keyboard and close paths,
// motion and scroll states under `replica` only, search typeahead, and site-owner decisions (agents cannot sign);
// hide lists: records explored with different ones (or not the expected --hide / presence.json one) are one error; the
// site-wide stardust/replica/presence.json sets the expected list with no flag (and names itself in the verdict).
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-compare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDecisions, compareDocs, compareHide, findingKey, pairControls } from '../chrome-compare.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const st = (links, extra = {}) => ({ opened: true, panel: { links: links.map((t) => ({ text: t, href: `/${t.toLowerCase().replace(/ /g, '-')}` })), headings: extra.headings || [], images: 0, inputs: [], buttons: [], options: 0, rect: [0, 72, 600, 300] }, expanded: extra.expanded ?? null, focus: 'panel', scrollLock: !!extra.lock, motion: extra.motion || [], tabReachesPanel: extra.tab, shot: null });
const ctl = (name, kind, actions, more = {}) => ({ name, key: name.toLowerCase(), role: 'toggle', kind, actions, ...more });
const doc = (controls, scroll = []) => ({ url: 'https://example.com/', widths: { 1440: { root: 'header', controls, scroll } } });

const shopLinks = ['Men', 'Women', 'Kids', 'Sale'];
const source = doc([
  ctl('Shop', 'menu', { hover: st(shopLinks, { motion: [{ prop: 'opacity', ms: 200 }], headings: ['Shop'] }), click: null, key: st(shopLinks, { expanded: 'true', tab: true }) },
    { close: { escape: true, focusReturn: true, outside: true, leave: true }, children: [ctl('Women', 'menu', { hover: st(['Dresses', 'Shoes']) })] }),
  { name: 'Search the site', key: 'search the site', role: 'input', kind: 'search', actions: {}, search: { probe: 'shoes', typeahead: { links: 3, options: 3 }, submit: 'https://example.com/search?q={q}' } },
], [{ at: 'top', top: 0, height: 96, position: 'sticky', inView: true }, { at: 'down', top: -96, height: 96, position: 'sticky', inView: false }]);

check('pairControls: by name first, then by family in order', () => {
  const p = pairControls([ctl('Bag', 'cart', {}), ctl('About', 'menu', {})], [ctl('About', 'menu', {}), ctl('Cart', 'cart', {})]);
  assert.deepEqual(p.map(([s, b]) => [s.name, b && b.name]), [['Bag', 'Cart'], ['About', 'About']]);
});
check('an identical build has no finding', () => {
  assert.deepEqual(compareDocs(source, structuredClone(source)).findings, []);
});
check('a stock header (click-only, fewer links, no motion, no Escape, no typeahead) fails on each', () => {
  const build = doc([
    ctl('Shop', 'menu', { hover: null, click: st(['Men', 'Women'], { expanded: 'true' }), key: st(['Men', 'Women'], { tab: false }) }, { close: { escape: false, focusReturn: false, outside: true, toggle: true } }),
    { name: 'Search', key: 'search', role: 'input', kind: 'search', actions: {}, search: { probe: 'shoes', typeahead: { links: 0, options: 0 }, submit: 'https://example.com/search?q={q}' } },
  ], [{ at: 'top', top: 0, height: 96, position: 'sticky', inView: true }, { at: 'down', top: 0, height: 96, position: 'sticky', inView: true }]);
  const ids = compareDocs(source, build).findings.map((f) => `${f.id}${f.action ? `[${f.action}]` : ''}:${f.path}`);
  for (const want of ['state-missing[hover]:Shop', 'keyboard[key]:Shop', 'close-path:Shop', 'keyboard:Shop', 'state-missing[type]:search', 'scroll-state[down]:(header)']) assert.ok(ids.includes(want), `missing ${want} in ${ids.join(' | ')}`);
  const content = compareDocs(source, build).findings.find((f) => f.id === 'panel-content');
  assert.match(content.detail, /2 of 4 links missing \(Kids, Sale\)/);
  assert.ok(ids.includes('control-missing:Shop > Women'), 'a level inside an open panel (the Women tab) is compared too');
});
check('functional profile: behaviour and content gate, motion and crops do not, scroll states only warn', () => {
  const build = structuredClone(source);
  build.widths[1440].controls[0].actions.hover.motion = [];
  build.widths[1440].scroll[1].inView = true;
  assert.deepEqual(compareDocs(source, build, { profile: 'functional' }).findings.map((f) => [f.id, f.severity]), [['scroll-state', 'warn']]);
  assert.deepEqual(compareDocs(source, build).findings.map((f) => [f.id, f.severity]), [['motion', 'error'], ['scroll-state', 'error']]);
});
check('motion: within max(80 ms, 25 %) passes, beyond fails', () => {
  const at = (ms) => { const b = structuredClone(source); b.widths[1440].controls[0].actions.hover.motion = [{ prop: 'opacity', ms }]; return compareDocs(source, b).findings.length; };
  assert.equal(at(260), 0); assert.equal(at(320), 1);
});
check('a control the build lacks; a width it was not explored at', () => {
  const f = compareDocs(source, { url: 'x', widths: { 1440: { root: 'header', controls: [], scroll: [] } } }).findings.map((x) => x.id);
  assert.deepEqual(f.slice(0, 2), ['control-missing', 'control-missing']);
  assert.equal(compareDocs({ widths: { 390: { root: 'header', controls: [] } } }, { widths: {} }).findings[0].id, 'width-missing');
});
check('decisions: a site-owner entry clears its finding (exact or prefix*); an agent-signed or unsigned one is ignored and reported', () => {
  const f = [{ id: 'state-missing', width: 1440, path: 'Cart', action: 'click', severity: 'error' }, { id: 'motion', width: 390, path: 'Open menu', severity: 'error' }];
  assert.equal(findingKey(f[0]), 'state-missing@1440 Cart [click]');
  const out = applyDecisions(structuredClone(f), [
    { finding: 'state-missing@1440 Cart*', decision: 'decided-out', reason: 'cart moves to the shop subdomain', by: 'Site owner (marketing lead)', at: '2026-10-09' },
    { finding: 'motion@390 Open menu', decision: 'accepted', by: 'agent', at: '2026-10-09' },
    { finding: 'motion@390 Open menu', decision: 'accepted' },
  ]);
  assert.equal(out[0].decided.decision, 'decided-out'); assert.equal(out[1].decided, undefined);
  assert.equal(out.filter((x) => x.id === 'decision-invalid').length, 2);
});

const hid = (d, list) => ({ ...structuredClone(d), hide: { list, presence: null, perWidth: {} } });
check('hide: equal lists (any order) → no finding, hide.consistent true, with or without the expected list', () => {
  const r = compareDocs(hid(source, ['.geo-bar', '.promo-strip']), hid(source, ['.promo-strip', '.geo-bar']), { expectedHide: ['.geo-bar', '.promo-strip'] });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.hide, { source: ['.geo-bar', '.promo-strip'], build: ['.promo-strip', '.geo-bar'], expected: ['.geo-bar', '.promo-strip'], consistent: true });
  assert.deepEqual(compareDocs(hid(source, ['.geo-bar']), hid(source, ['.geo-bar'])).hide, { source: ['.geo-bar'], build: ['.geo-bar'], expected: null, consistent: true });
});
check('hide: the source hid the bar, the build did not → one hide-mismatch error naming both lists', () => {
  const r = compareDocs(hid(source, ['.geo-bar']), structuredClone(source));
  assert.equal(r.findings.length, 1);
  const [f] = r.findings;
  assert.deepEqual([f.id, f.severity, findingKey(f)], ['hide-mismatch', 'error', 'hide-mismatch@0 (hide)']);
  assert.match(f.detail, /not explored on the same page — hide lists: source \[\.geo-bar\], build \[\]; re-explore the build with chrome-explore --hide \.geo-bar$/);
  assert.deepEqual(r.hide, { source: ['.geo-bar'], build: [], expected: null, consistent: false });
});
check('hide: an expected list that differs from both records → finding; expected but no record hid anything → finding', () => {
  const { hide, finding } = compareHide(hid(source, ['.geo-bar']), hid(source, ['.geo-bar']), ['.geo-bar', '.promo-strip']);
  assert.equal(hide.consistent, false);
  assert.match(finding.detail, /expected \[\.geo-bar, \.promo-strip\]; re-explore both sides with chrome-explore --hide \.geo-bar,\.promo-strip$/);
  assert.match(compareHide(hid(source, ['.geo-bar']), hid(source, ['.geo-bar']), []).finding.detail, /re-explore both sides with chrome-explore without --hide$/);
  assert.equal(compareHide(source, source, ['.geo-bar']).finding.id, 'hide-mismatch');
  assert.equal(compareDocs(source, structuredClone(source), { expectedHide: ['.geo-bar'] }).findings[0].id, 'hide-mismatch');
});
check('hide: none anywhere → compareDocs returns { findings, visual } as before (an empty expected list changes nothing)', () => {
  assert.deepEqual(Object.keys(compareDocs(source, structuredClone(source))), ['findings', 'visual']);
  assert.deepEqual(compareDocs(source, structuredClone(source), { expectedHide: [] }), { findings: [], visual: [] });
  assert.deepEqual(compareHide(source, source, []), { hide: null, finding: null });
});

const COMPARE = fileURLToPath(new URL('../chrome-compare.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'chrome-compare-'));
const put = (name, d) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(d)); return f; };
const cli = (...args) => spawnSync(process.execPath, [COMPARE, ...args], { cwd: dir, encoding: 'utf8' });
const plain = put('plain.json', source); const geo = put('geo.json', hid(source, ['.geo-bar']));
check('CLI: source hides, build does not → exit 2, the 🔴 line, the hide line and the verdict\'s hide', () => {
  const v = join(dir, 'v1.json');
  const r = cli(geo, plain, '--json', v);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stdout, /^🔴 hide-mismatch@0 \(hide\) — the records were not explored on the same page/m);
  assert.match(r.stdout, /^chrome-compare hide: source \[\.geo-bar\] · build \[\] · expected not given → INCONSISTENT$/m);
  const verdict = JSON.parse(readFileSync(v, 'utf8'));
  assert.deepEqual(verdict.hide, { source: ['.geo-bar'], build: [], expected: null, consistent: false });
  assert.equal(verdict.counts.error, 1);
});
check('CLI: --presence {"*": {"hide": [".geo-bar"]}} --slug home is the expected list; --presence without --slug exits 1', () => {
  const pf = put('presence.json', { '*': { hide: ['.geo-bar'] } });
  const v = join(dir, 'v2.json');
  const r = cli(geo, put('geo-build.json', hid(source, ['.geo-bar'])), '--presence', pf, '--slug', 'home', '--json', v);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chrome-compare hide: source \[\.geo-bar\] · build \[\.geo-bar\] · expected \[\.geo-bar\] → consistent$/m);
  assert.deepEqual(JSON.parse(readFileSync(v, 'utf8')).hide, { source: ['.geo-bar'], build: ['.geo-bar'], expected: ['.geo-bar'], consistent: true });
  assert.equal(cli(geo, geo, '--hide', '.geo-bar,.promo-strip').status, 2);
  const u = cli(geo, geo, '--presence', pf);
  assert.equal(u.status, 1); assert.match(u.stderr, /--presence needs --slug/);
});
check('CLI: no hide anywhere → the output and the verdict\'s fields as before', () => {
  const v = join(dir, 'v3.json');
  const r = cli(plain, put('plain-build.json', source), '--json', v);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `chrome-compare: 0 error(s), 0 warning(s), 0 decided (profile replica, widths 1440) → ${v}\n`);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(v, 'utf8'))), ['tool', 'at', 'source', 'build', 'profile', 'bar', 'widths', 'counts', 'findings']);
});
// a project with the site-wide stardust/replica/presence.json: read by default, no flag needed
const project = join(dir, 'project');
mkdirSync(join(project, 'stardust', 'replica'), { recursive: true });
const siteFile = join(project, 'stardust', 'replica', 'presence.json');
const cliIn = (cwd, ...args) => spawnSync(process.execPath, [COMPARE, ...args], { cwd, encoding: 'utf8' });
check('CLI, no hide flag: the site file\'s "*".hide is the expected list — records without it fail, records with it pass; the verdict names the site file', () => {
  writeFileSync(siteFile, JSON.stringify({ '*': { hide: ['.geo-bar'] }, home: { hide: ['.site-strip'] } }));
  const v = join(dir, 'v4.json');
  const bad = cliIn(project, plain, put('plain-build2.json', source), '--json', v);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^🔴 hide-mismatch@0 \(hide\) — .*re-explore both sides with chrome-explore --hide \.geo-bar$/m);
  assert.match(bad.stdout, /^chrome-compare hide: source \[\] · build \[\] · expected \[\.geo-bar\] \(with site stardust\/replica\/presence\.json\) → INCONSISTENT$/m);
  assert.deepEqual(JSON.parse(readFileSync(v, 'utf8')).hide, { source: [], build: [], expected: ['.geo-bar'], consistent: false, site: 'stardust/replica/presence.json' });
  const good = cliIn(project, geo, put('geo-build2.json', hid(source, ['.geo-bar'])));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /^chrome-compare hide: source \[\.geo-bar\] · build \[\.geo-bar\] · expected \[\.geo-bar\] \(with site stardust\/replica\/presence\.json\) → consistent$/m);
  assert.equal(cliIn(project, geo, geo, '--slug', 'home').status, 2, '--slug alone adds the site file\'s home entry to the expected list');
});
check('CLI: a site file naming no selector for the page leaves the output as before; a malformed one exits 1 naming it', () => {
  writeFileSync(siteFile, JSON.stringify({ about: { hide: ['.about-strip'] } }));
  const r = cliIn(project, plain, put('plain-build3.json', source));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'chrome-compare: 0 error(s), 0 warning(s), 0 decided (profile replica, widths 1440)\n');
  writeFileSync(siteFile, '{"*": {');
  const u = cliIn(project, plain, plain);
  assert.equal(u.status, 1); assert.match(u.stderr, /^chrome-compare: presence\.json stardust\/replica\/presence\.json unreadable \(/m);
});
rmSync(dir, { recursive: true });
process.exit(failed ? 1 : 0);
