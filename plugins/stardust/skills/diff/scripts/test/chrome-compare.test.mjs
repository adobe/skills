#!/usr/bin/env node
// skills/diff/scripts/test/chrome-compare.test.mjs — the header-parity verdict from two chrome-explore records (no browser):
// pairing by name then family, a hover menu rebuilt as click-only, missing panel links, keyboard and close paths,
// motion and scroll states under `replica` only, search typeahead, and site-owner decisions (agents cannot sign).
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-compare.test.mjs
import assert from 'node:assert/strict';
import { applyDecisions, compareDocs, findingKey, pairControls } from '../chrome-compare.mjs';

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
process.exit(failed ? 1 : 0);
