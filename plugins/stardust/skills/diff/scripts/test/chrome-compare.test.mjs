#!/usr/bin/env node
// skills/diff/scripts/test/chrome-compare.test.mjs — the header-parity verdict from two chrome-explore records (no browser):
// pairing by name then family, a hover menu rebuilt as click-only, missing panel links (a link with text on one side
// only pairs by its address, in the header as in a panel), the at-rest watch of the two records, keyboard and close paths,
// motion and scroll states under `replica` only, search typeahead, and site-owner decisions (agents cannot sign).
// The round cap (the CLI, in a scratch project): three counted comparisons per stage in stardust/chrome/rounds.json, the
// fourth refused (exit 6) until every remaining error has a class in the decisions file; classes are written beside the
// findings and clear nothing; the guard fails closed. --status: the header contract's verdict at a stage, for gate.sh.
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-compare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES, applyDecisions, compareDocs, findingKey, pairControls, pairLinks, replicaProject, samePage, stageOfBuild, stageStatus, unclassedAt } from '../chrome-compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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
check('a link with text on one side only pairs by its address: one link-text warning, no missing link', () => {
  const panel = (links) => doc([ctl('Help', 'menu', { click: { ...st([]), panel: { ...st([]).panel, links } } })]);
  const texts = [{ text: 'Feedback', href: 'https://example.com/feedback' }, { text: 'Contact', href: '/contact.html' }];
  const bare = texts.map((l) => ({ ...l, text: '' }));
  // the source recorded no link text (a recorder that could not read it), the build has it
  const f = compareDocs(panel(bare), panel(texts)).findings;
  assert.deepEqual(f.map((x) => [x.id, x.severity]), [['link-text', 'warn']]);
  assert.match(f[0].detail, /^2 link\(s\) paired by address, with text on one side only: \/feedback \("Feedback" on the build only\); \/contact /);
  // the build lost a label (an icon-only link): still the same link, and still said
  assert.deepEqual(compareDocs(panel(texts), panel(bare)).findings.map((x) => [x.id, x.severity]), [['link-text', 'warn']]);
  assert.deepEqual(compareDocs(panel(bare), panel(bare)).findings, [], 'no text on either side: paired by address, nothing to say');
  // an address the build does not have is a missing link, with or without text on the source
  const gone = compareDocs(panel(bare), panel(texts.slice(0, 1))).findings.find((x) => x.id === 'panel-content');
  assert.deepEqual([gone.severity, gone.detail], ['error', '1 of 2 links missing (/contact.html)']);
  assert.match(compareDocs(panel(texts), panel(texts.slice(0, 1))).findings.find((x) => x.id === 'panel-content').detail, /1 of 2 links missing \(Contact\)/);
  // two different texts at one address are not a pair: a renamed link is missing, as before
  const renamed = compareDocs(panel(texts), panel([texts[0], { text: 'Get in touch', href: '/contact.html' }])).findings;
  assert.deepEqual(renamed.map((x) => [x.id, x.severity]), [['panel-content', 'error']]);
  // text still pairs first: the same label at another address is a moved link
  assert.deepEqual(compareDocs(panel(texts), panel([texts[0], { text: 'Contact', href: '/help/contact' }])).findings.map((x) => x.id), ['link-href']);
});
check('pairLinks: name first, then address when a side has no name; a build item pairs once when asked', () => {
  const L = (text, href) => ({ text, href }); const o = { name: (l) => l.text, addr: (l) => l.href };
  const by = (src, bld, more = {}) => pairLinks(src, bld, { ...o, ...more }).map((p) => [p.b && bld.indexOf(p.b), p.by]);
  // the unnamed source link does not take the build link another source link pairs with by name
  assert.deepEqual(by([L('', '/'), L('Home', '/')], [L('Home', '/'), L('', '/')]), [[1, 'address'], [0, 'name']]);
  assert.deepEqual(by([L('', '/'), L('', '/')], [L('Logo', '/'), L('Home', '/')]), [[0, 'address'], [1, 'address']]);
  assert.deepEqual(by([L('A', '/a'), L('A', '/b')], [L('A', '/a'), L('A', '/b')]), [[0, 'name'], [1, 'name']], 'the same name twice: each at its own address');
  assert.deepEqual(by([L('A', '/a')], [L('B', '/a')]), [[null, null]], 'two names at one address are two links');
  assert.deepEqual(by([L('A', '/a'), L('A', '/a')], [L('A', '/a')]), [[0, 'name'], [0, 'name']], 'a set: the one build link answers both');
  assert.deepEqual(by([L('A', '/a'), L('A', '/a')], [L('A', '/a')], { once: true }), [[0, 'name'], [null, null]]);
});
check('a header link with a name on one side only (a logo) pairs by its address: link-text, never link-missing', () => {
  const link = (name, href, more = {}) => ({ name, key: name.toLowerCase(), role: 'link', kind: 'link', href, actions: {}, ...more });
  const src = doc([link('', 'https://example.com/'), link('Government', 'https://example.com/'), link('', '/about')]);
  const build = doc([link('Home', 'https://build.test/index.html'), link('Government', '/'), link('About us', '/about/')]);
  const f = compareDocs(src, build).findings;
  assert.deepEqual(f.map((x) => [findingKey(x), x.severity]), [['link-text@1440 (header)', 'warn']]);
  assert.equal(f[0].detail, '2 link(s) paired by address, with text on one side only: / ("Home" on the build only); /about ("About us" on the build only)');
  assert.deepEqual(compareDocs(build, src).findings.map((x) => x.id), ['link-text'], 'the build lost the names: the same pairs');
  assert.deepEqual(compareDocs(src, structuredClone(src)).findings, [], 'no name on either side: nothing to say');
  // an address the build header lacks, and a link named differently on both sides, are still missing links
  const gone = compareDocs(src, doc([link('Home', '/'), link('Government', '/')])).findings;
  assert.deepEqual(gone.map((x) => [x.id, x.path, x.detail]), [['link-missing', 'link', 'top-level link /about not in the build header'], ['link-text', '(header)', '1 link(s) paired by address, with text on one side only: / ("Home" on the build only)']]);
  assert.deepEqual(compareDocs(doc([link('Contact', '/contact')]), doc([link('Get in touch', '/contact')])).findings.map((x) => x.id), ['link-missing']);
  // a control that is not a link has no address: an unnamed toggle still pairs by family only
  const toggle = ctl('', 'search', { click: st(['Help']) });
  assert.deepEqual(compareDocs(doc([toggle]), doc([{ ...toggle, name: 'Search', key: 'search' }])).findings, []);
});
check('at-rest watch: a difference in what the two records excluded warns; a watch that could not run is an error; no record on one side is said', () => {
  const ran = (excluded) => ({ status: 'ran', ms: 8012, samples: 20, excluded, regions: excluded ? [{ sel: 'main>div', rect: [0, 96, 1440, 500] }] : [] });
  const pair = (sw, bw) => { const a = doc([]); const b = doc([]); if (sw) a.widths[1440].watch = sw; if (bw) b.widths[1440].watch = bw; return compareDocs(a, b).findings.map((x) => [findingKey(x), x.severity, x.detail]); };
  assert.deepEqual(pair(ran(1), ran(1)), []);
  assert.deepEqual(pair(ran(0), { status: 'not-triggered' }), [], 'neither side excluded anything');
  assert.deepEqual(pair(undefined, undefined), [], 'two records without it: nothing to compare');
  assert.deepEqual(pair(ran(1), { status: 'not-triggered' }), [['at-rest-watch@1440 (page)', 'warn', 'source at-rest watch: 8.0 s, 1 self-changing region(s) excluded: main>div [0,96,1440,500] | build at-rest watch: not run (no action revealed content outside the header)']]);
  assert.match(pair(ran(1), undefined)[0][2], /\| build at-rest watch: not recorded/);
  assert.deepEqual(pair(undefined, ran(0)).map((x) => x.slice(0, 2)), [['at-rest-watch@1440 (page)', 'warn']], 'not recorded is not "nothing excluded"');
  assert.deepEqual(pair(undefined, { status: 'not-triggered' }), [], 'an old contract against a build whose watch had nothing to do: no warning');
  assert.deepEqual(pair({ status: 'not-triggered' }, undefined), [], 'and the other way round');
  assert.match(pair(undefined, ran(1))[0][2], /explore the side without the record again/);
  const failed = pair(ran(0), { status: 'failed', ms: 0, reason: 'no sample of the page at rest in 0 ms' });
  assert.deepEqual(failed, [['at-rest-watch@1440 (build)', 'error', 'at-rest watch: COULD NOT RUN (no sample of the page at rest in 0 ms), no self-changing region was excluded: explore the build again']]);
  assert.deepEqual(pair({ status: 'later' }, undefined).map((x) => x.slice(0, 2)), [['at-rest-watch@1440 (source)', 'error']], 'a status this version does not know is not read as a watch that ran');
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
check('a source control not reached before the build request budget is a warning', () => {
  const build = doc([]);
  build.widths[1440].truncated = 'request-budget';
  const missing = compareDocs(doc([ctl('Shop', 'menu', { click: st(shopLinks) })]), build).findings.find((f) => f.id === 'control-missing');
  assert.equal(missing.severity, 'warn');
  assert.match(missing.detail, /not observed: the build record stopped at the request budget \(run the build side with --max-requests 0\)$/);
  const budget = compareDocs(source, build).findings.find((f) => f.id === 'budget-truncated');
  assert.match(budget.detail, /--max-requests 0/);
  build.widths[1440].root = null;
  assert.match(compareDocs(source, build).findings.find((f) => f.id === 'budget-truncated').detail, /--max-requests 0/);
});
check('an action absent from a partial build control is a warning', () => {
  const src = doc([ctl('Shop', 'menu', { click: st(shopLinks) })]);
  const build = doc([ctl('Shop', 'menu', {}, { partial: 'request-budget' })]);
  const missing = compareDocs(src, build).findings.find((f) => f.id === 'state-missing');
  assert.deepEqual([missing.action, missing.severity], ['click', 'warn']);
  assert.match(missing.detail, /not observed: the build record stopped at the request budget/);
});
check('an observed build action that fails remains an error', () => {
  const src = doc([ctl('Shop', 'menu', { click: st(shopLinks) })]);
  const build = doc([ctl('Shop', 'menu', { click: { opened: false } })]);
  const missing = compareDocs(src, build).findings.find((f) => f.id === 'state-missing');
  assert.deepEqual([missing.action, missing.severity], ['click', 'error']);
  assert.doesNotMatch(missing.detail, /not observed/);
});
check('a nested child absent below a partial build control is a warning', () => {
  const parent = (children, more = {}) => ctl('Shop', 'menu', { click: st(shopLinks) }, { close: {}, children, ...more });
  const src = doc([parent([ctl('Women', 'menu', { click: st(['Dresses']) })])]);
  const build = doc([parent([], { partial: 'request-budget' })]);
  const missing = compareDocs(src, build).findings.find((f) => f.path === 'Shop > Women');
  assert.deepEqual([missing.id, missing.severity], ['control-missing', 'warn']);
  assert.match(missing.detail, /not observed: the build record stopped at the request budget/);
});
check('a build search input skipped past the typeahead cap warns without throwing', () => {
  const build = structuredClone(source);
  const input = build.widths[1440].controls[1];
  input.search = null;
  input.skipped = 'typeahead-cap';
  const typeahead = compareDocs(source, build).findings.find((f) => f.id === 'state-missing' && f.action === 'type');
  assert.equal(typeahead.severity, 'warn');
});
check('a source search input skipped past the typeahead cap produces no finding', () => {
  const skipped = structuredClone(source);
  skipped.widths[1440].controls[1].search = null;
  skipped.widths[1440].controls[1].skipped = 'typeahead-cap';
  assert.deepEqual(compareDocs(skipped, source).findings, []);
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
check('classes: written beside the error, never a clearance; an exact key, a known class and a reason are required', () => {
  const f = [{ id: 'state-missing', width: 1440, path: 'Cart', action: 'click', severity: 'error' }, { id: 'motion', width: 390, path: 'Open menu', severity: 'error' }, { id: 'link-href', width: 390, path: 'Shop', severity: 'warn' }];
  const out = applyDecisions(structuredClone(f), [
    { finding: 'state-missing@1440 Cart [click]', class: 'owner', reason: ' the cart is the shop vendor\'s widget ', by: 'agent', at: '2026-10-09' },
    { finding: 'motion@390 Open menu', class: 'instrument', reason: 'the recorder read a carousel as motion: header-build.json' },
    { finding: 'motion@390*', class: 'accept-residual', reason: 'a prefix is not one finding' },
    { finding: 'motion@390 Open menu', class: 'later', reason: 'not a class' },
    { finding: 'motion@390 Open menu', class: 'owner' },
    { finding: 'link-href@390 Shop', class: 'accept-residual', reason: 'a warning has nothing to class' },
  ]);
  assert.deepEqual(out[0].classed, { class: 'owner', reason: 'the cart is the shop vendor\'s widget', at: '2026-10-09' });
  assert.deepEqual([out[0].decided, out[1].decided], [undefined, undefined], 'a class is not a decision, whoever signs it');
  assert.equal(out[1].classed.class, 'instrument'); assert.equal(out[2].classed, undefined);
  assert.equal(out.filter((x) => x.id === 'decision-invalid').length, 3);
  assert.match(out.find((x) => x.id === 'decision-invalid').detail, /a class is one of owner \| instrument \| accept-residual, with a `reason`, for one finding key/);
  assert.deepEqual(CLASSES, ['owner', 'instrument', 'accept-residual']);
  // the owner's signed decision on a classed finding still clears it
  const both = applyDecisions(structuredClone(f), [{ finding: 'motion@390 Open menu', class: 'owner', reason: 'r', decision: 'accepted', by: 'Site owner', at: '2026-10-09' }]);
  assert.equal(both[1].decided.by, 'Site owner'); assert.equal(both[1].classed.class, 'owner');
});
check('stageOfBuild is gate.sh\'s rule; samePage folds scheme, www., the index file and the trailing slash', () => {
  assert.deepEqual(['http://localhost:8791/home-proposed.html?x=1', 'http://127.0.0.1:3000/', 'file:///p/about-proposed.html', 'https://main--site--org.aem.page/', undefined].map(stageOfBuild), ['prototype', 'local-build', 'prototype', 'published', 'published']);
  assert.ok(samePage('https://www.example.com/', 'http://example.com/index.html?utm=1#top'));
  assert.ok(samePage('https://example.com/en/home/', 'https://example.com/en/home'));
  assert.ok(!samePage('https://example.com/', 'https://example.com/about')); assert.ok(!samePage('https://example.com/', 'https://shop.example.com/')); assert.ok(!samePage(undefined, undefined));
});
check('stageStatus: nothing without a contract or for another page; NOT COMPARED and FAIL fail, PASS and CAPPED do not', () => {
  const contract = { url: 'https://example.com/' }; const page = 'https://www.example.com/';
  const t = (o = {}) => ({ rounds: 0, counted: 0, allowance: 3, closed: null, last: null, ...o });
  const at = (o, more = {}) => stageStatus({ contract, page, t: t(o), command: 'CMD', decisions: 'D.json', ...more });
  assert.equal(stageStatus({ contract: null, page, t: t(), command: 'CMD' }), null);
  assert.equal(at({}, { page: 'https://example.com/about' }), null);
  assert.deepEqual(at({}), { rc: 2, line: 'header contract: NOT COMPARED at this stage — CMD' });
  assert.deepEqual(at({ rounds: 1, counted: 1, last: { verdict: 'fail' } }), { rc: 2, line: 'header contract: FAIL at this stage — 1 counted round of 3, the last one a FAIL: fix the header, then CMD' });
  assert.match(at({ rounds: 3, counted: 3, last: { verdict: 'fail' } }).line, /^header contract: FAIL at this stage — 3 counted rounds of 3, the last one a FAIL: record a class per remaining error in D\.json /);
  assert.deepEqual(at({ rounds: 2, counted: 2, last: { verdict: 'pass' } }), { rc: 0, line: 'header contract: PASS at this stage (2 counted rounds)' });
  assert.deepEqual(at({ rounds: 3, counted: 3, last: { verdict: 'fail' }, closed: { decision: 'accept-residual', reason: '2 classed' } }), { rc: 0, line: 'header contract: CAPPED at this stage — 3 counted rounds, closed by accept-residual: 2 classed' });
  // a closing decision alone is not a class
  assert.deepEqual(at({ rounds: 3, counted: 3, last: { verdict: 'fail' }, closed: { decision: 'accept-residual', reason: 'by hand' } }, { unclassed: '2 of 2 error(s) have no class' }), { rc: 2, line: 'header contract: FAIL at this stage — closed in the ledger by accept-residual, but 2 of 2 error(s) have no class: record a class per remaining error in D.json (chrome-compare.mjs --help § Round cap), then CMD' });
  const parity = { stage: 'prototype', findings: [{ id: 'motion', width: 390, path: 'Menu', severity: 'error', classed: { class: 'owner', reason: 'written by hand' } }, { id: 'link-href', width: 390, path: 'Shop', severity: 'warn' }] };
  assert.equal(unclassedAt(parity, 'prototype', []), '1 of 1 error(s) have no class', 'the class must be in the decisions file, not only in the verdict');
  assert.equal(unclassedAt(parity, 'prototype', [{ finding: 'motion@390 Menu', class: 'owner', reason: 'r' }]), null);
  assert.equal(unclassedAt(parity, 'published', []), 'the verdict file is of the prototype stage');
  assert.equal(unclassedAt(null, 'prototype', []), 'no verdict file of the comparison');
});

// ── the CLI in a scratch project: the round cap, its classes, the guard, --status ──
const CLI = join(HERE, '..', 'chrome-compare.mjs');
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'chrome-compare-')));
const stockBuild = (url) => ({ ...doc([ctl('Shop', 'menu', { hover: null, click: st(shopLinks, { expanded: 'true' }), key: st(shopLinks, { expanded: 'true', tab: true }) }, { close: { escape: true, focusReturn: true, outside: true, leave: true } }), source.widths[1440].controls[1]], source.widths[1440].scroll), url });
const project = (buildUrl = 'http://localhost:8791/home-proposed.html', flow = 'replica') => {
  const root = scratch();
  mkdirSync(join(root, 'stardust', 'chrome'), { recursive: true });
  writeFileSync(join(root, 'stardust/chrome/header-contract.json'), JSON.stringify(source));
  writeFileSync(join(root, 'stardust/chrome/header-build.json'), JSON.stringify(stockBuild(buildUrl)));
  if (flow) writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ flow }));
  return root;
};
const run = (root, extra = [], env = {}, script = CLI) => spawnSync(process.execPath, [script, ...(extra.includes('--status') ? [] : ['stardust/chrome/header-contract.json', 'stardust/chrome/header-build.json', '--profile', 'functional', '--json', 'stardust/chrome/header-parity.json']), ...extra], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, STARDUST_ROUND_CAP: '', ...env } });
const json = (root, name) => JSON.parse(readFileSync(join(root, 'stardust/chrome', name), 'utf8'));
const decisions = (root, list) => writeFileSync(join(root, 'stardust/chrome/header-decisions.json'), JSON.stringify({ decisions: list }));
const KEYS = ['state-missing@1440 Shop [hover]', 'control-missing@1440 Shop > Women'];

check('round cap: three comparisons are recorded, the fourth exits 6 and writes no verdict', () => {
  const root = project();
  try {
    const rcs = [1, 2, 3].map(() => run(root));
    assert.deepEqual(rcs.map((r) => r.status), [2, 2, 2], rcs[0].stderr);
    assert.match(rcs[0].stdout, /^chrome-compare: prototype stage — recorded "compare-1" fail as first: 1 of 3 counted rounds$/m);
    assert.match(rcs[2].stdout, /recorded "compare-3" fail as fix: 3 of 3 counted rounds — cap reached: the next comparison at this stage exits 6 until every remaining error has a class in stardust\/chrome\/header-decisions\.json/);
    assert.deepEqual(json(root, 'rounds.json').stages.prototype.rounds.map((x) => `${x.label}:${x.verdict}:${x.kind}`), ['compare-1:fail:first', 'compare-2:fail:fix', 'compare-3:fail:fix']);
    const third = json(root, 'header-parity.json');
    assert.deepEqual([third.stage, third.round, third.counts.error, third.counts.classed, third.capped], ['prototype', { label: 'compare-3', kind: 'fix' }, 2, 0, undefined]);
    assert.deepEqual(third.findings.filter((f) => f.severity === 'error').map((f) => f.key), KEYS);
    const r = run(root);
    assert.equal(r.status, 6, r.stdout + r.stderr);
    assert.match(r.stderr, /^chrome-compare: comparison refused at the prototype stage \(exit 6\) — 3 of 3 counted rounds spent, the last one a FAIL, and 2 of 2 error\(s\) still have no class\. Record one per finding in stardust\/chrome\/header-decisions\.json — \{ "decisions": \[\{ "finding": "<key>", "class": "owner\|instrument\|accept-residual", "reason": /);
    assert.ok(r.stderr.includes(`No class: ${KEYS.join('; ')}`), r.stderr);
    assert.match(r.stderr, /rounds\.mjs decide stardust\/chrome --stage prototype --decision extend/);
    assert.equal(r.stdout, '', 'a refused comparison prints no finding');
    assert.equal(json(root, 'header-parity.json').at, third.at, 'the verdict of the last counted round stays');
    assert.equal(json(root, 'rounds.json').stages.prototype.rounds.length, 3);
    // one class is not every class
    decisions(root, [{ finding: KEYS[0], class: 'owner', reason: 'the mega menu needs the source\'s menu service' }]);
    const one = run(root);
    assert.equal(one.status, 6); assert.match(one.stderr, /1 of 2 error\(s\) still have no class/); assert.ok(one.stderr.includes(`No class: ${KEYS[1]}`));
    // a stage has its own budget: the same build on a published origin starts at round one
    writeFileSync(join(root, 'stardust/chrome/header-build.json'), JSON.stringify(stockBuild('https://main--site--org.aem.page/')));
    const pub = run(root, [], {});
    assert.equal(pub.status, 2); assert.match(pub.stdout, /published stage — recorded "compare-1" fail as first/);
    assert.match(run(root, ['--stage', 'prototype']).stderr, /refused at the prototype stage/, '--stage overrides the URL rule');
    assert.equal(run(root, ['--stage', 'foundation']).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('round cap: with a class per remaining error the comparison runs — exit 2, the classes beside the findings, nothing cleared; an agent-signed owner decision is still ignored', () => {
  const root = project();
  try {
    for (let i = 0; i < 3; i += 1) run(root);
    decisions(root, [
      { finding: KEYS[0], class: 'owner', reason: 'the mega menu needs the source\'s menu service (dynamics row nav-menu)' },
      { finding: KEYS[1], class: 'instrument', reason: 'the recorder never reached the second level: header-build.json' },
      { finding: KEYS[0], decision: 'accepted', by: 'agent', at: '2026-11-20' },
    ]);
    const r = run(root);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^🔴 state-missing@1440 Shop \[hover\] — .* \[class owner: the mega menu needs the source's menu service \(dynamics row nav-menu\)\]$/m);
    assert.match(r.stdout, /^chrome-compare: 2 error\(s\), 2 warning\(s\), 0 decided \(profile functional, widths 1440\) — classes: 1 owner, 1 instrument → stardust\/chrome\/header-parity\.json$/m);
    assert.match(r.stdout, /^chrome-compare: prototype stage — capped after 3 of 3 counted rounds: every remaining error has a class \(1 owner, 1 instrument\), the stage is closed and this comparison is not counted$/m);
    const v = json(root, 'header-parity.json');
    assert.deepEqual([v.capped, v.round, v.counts], [true, undefined, { error: 2, warn: 2, decided: 0, classed: 2 }]);
    assert.deepEqual(v.findings.filter((f) => f.severity === 'error').map((f) => [f.key, f.classed.class, f.decided]), [[KEYS[0], 'owner', undefined], [KEYS[1], 'instrument', undefined]]);
    assert.match(v.findings.find((f) => f.id === 'decision-invalid').detail, /a decision needs the site owner's `by` and `at`/);
    const st0 = json(root, 'rounds.json').stages.prototype;
    assert.deepEqual([st0.rounds.length, st0.decisions.map((d) => d.decision)], [3, ['accept-residual']]);
    assert.match(st0.decisions[0].reason, /^2 header-contract error\(s\) classed \(1 owner, 1 instrument\) in stardust\/chrome\/header-decisions\.json$/);
    // closed: later comparisons run uncounted while every error is classed, and are refused when one is not
    assert.equal(run(root).status, 2); assert.equal(json(root, 'rounds.json').stages.prototype.decisions.length, 1);
    decisions(root, [{ finding: KEYS[0], class: 'owner', reason: 'the menu service' }]);
    const again = run(root);
    assert.equal(again.status, 6); assert.match(again.stderr, /the stage was closed after 3 of 3 counted rounds, and 1 of 2 error\(s\) have no class/);
    // the site owner's signature is what clears: no error left, exit 0, recorded as a pass
    decisions(root, KEYS.map((k) => ({ finding: k, decision: 'accepted', reason: 'agreed', by: 'Site owner', at: '2026-11-20' })));
    const owner = run(root);
    assert.equal(owner.status, 0, owner.stderr); assert.equal(json(root, 'rounds.json').stages.prototype.rounds.at(-1).verdict, 'pass');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('round cap: a pass after a pass is free; the guard fails closed on a ledger it cannot read or write, and STARDUST_ROUND_CAP=0 compares without it', () => {
  const root = project();
  try {
    writeFileSync(join(root, 'stardust/chrome/header-build.json'), JSON.stringify({ ...source, url: 'http://localhost:8791/home-proposed.html' }));
    for (let i = 0; i < 5; i += 1) assert.equal(run(root).status, 0);
    assert.deepEqual(json(root, 'rounds.json').stages.prototype.rounds.map((x) => x.kind), ['first', 'confirm', 'confirm', 'confirm', 'confirm']);
    writeFileSync(join(root, 'stardust/chrome/rounds.json'), '{ "version": 1, "stages": ');
    const bad = run(root);
    assert.equal(bad.status, 1); assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /^chrome-compare: the round cap could not be checked — stardust\/chrome\/rounds\.json is not a readable round ledger: repair or delete it — so nothing is compared \(STARDUST_ROUND_CAP=0 compares without the cap\)$/m);
    const off = run(root, [], { STARDUST_ROUND_CAP: '0' });
    assert.equal(off.status, 0); assert.match(off.stderr, /the comparison runs uncounted \(STARDUST_ROUND_CAP=0\)/);
    // a ledger folder that cannot be made (a file is in its place)
    writeFileSync(join(root, 'blocked'), '');
    const nodir = run(root, ['--rounds', 'blocked/chrome']);
    assert.equal(nodir.status, 1); assert.match(nodir.stderr, /the round cap could not be checked/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  // STARDUST_ROUND_CAP=0 at the cap: the round is recorded, never refused
  const capped = project();
  try {
    for (let i = 0; i < 4; i += 1) assert.equal(run(capped, [], { STARDUST_ROUND_CAP: '0' }).status, 2);
    assert.equal(json(capped, 'rounds.json').stages.prototype.rounds.length, 4);
  } finally { rmSync(capped, { recursive: true, force: true }); }
});
const copyWithoutMaster = () => {
  const root = mkdtempSync(join(tmpdir(), 'diff-nomaster-'));
  const copy = join(root, 'a', 'b');
  cpSync(join(HERE, '..'), copy, { recursive: true, filter: (src) => !src.endsWith('/test') });
  return { root, copy };
};
check('not a replica project (redesign, reskin, no state): the comparison runs as before this branch — same exit, same findings, no ledger, one line saying it is not counted', () => {
  const before = compareDocs(source, stockBuild('http://localhost:8791/home-proposed.html'), { profile: 'functional' }).findings;
  for (const [flow, why] of [[null, 'no flow "replica" in stardust/state.json and no stardust/replica/'], ['redesign', 'stardust/state.json flow "redesign" and no stardust/replica/'], ['reskin', 'stardust/state.json flow "reskin" and no stardust/replica/']]) {
    const root = project(undefined, flow);
    try {
      const { copy, root: copyRoot } = copyWithoutMaster(); // no replica scripts beside it either: nothing to fail on
      cpSync(join(HERE, '..', '..', '..', 'stardust', 'scripts'), join(copyRoot, 'a', 'stardust'), { recursive: true });
      for (const script of [CLI, join(copy, 'chrome-compare.mjs')]) {
        for (let i = 0; i < 5; i += 1) {
          const r = run(root, [], {}, script);
          assert.equal(r.status, 2, r.stderr); assert.equal(r.stderr, '');
          assert.deepEqual(r.stdout.trim().split('\n').slice(-2), ['chrome-compare: 2 error(s), 1 warning(s), 0 decided (profile functional, widths 1440) → stardust/chrome/header-parity.json', `chrome-compare: not counted, no round cap — this is not a replica project (${why}); the cap is the replica flow's (--help § Round cap)`]);
        }
        const v = json(root, 'header-parity.json');
        assert.deepEqual(v.findings.map(({ key, ...f }) => f), before, 'the findings of compareDocs, untouched');
        assert.deepEqual([v.round, v.capped, v.counts.error], [undefined, undefined, 2]);
      }
      assert.ok(!existsSync(join(root, 'stardust/chrome/rounds.json')), 'no ledger outside a replica project');
      rmSync(copyRoot, { recursive: true, force: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  assert.equal(replicaProject(scratch()).replica, false);
});
check('a replica project is told by state.json flow or by stardust/replica/; a state.json that cannot be read refuses the comparison', () => {
  const root = project(undefined, null);
  try {
    mkdirSync(join(root, 'stardust/replica/gates'), { recursive: true });
    assert.deepEqual(replicaProject(root), { replica: true, why: 'stardust/replica/ exists' });
    assert.match(run(root).stdout, /prototype stage — recorded "compare-1" fail as first/);
    assert.deepEqual(replicaProject(project()), { replica: true, why: 'stardust/state.json flow "replica"' });
    rmSync(join(root, 'stardust/replica'), { recursive: true });
    writeFileSync(join(root, 'stardust/state.json'), '{ "flow": ');
    const r = run(root);
    assert.equal(r.status, 1); assert.equal(r.stdout, ''); assert.match(r.stderr, /the round cap could not be checked — stardust\/state\.json cannot be read .* so the flow cannot be told — so nothing is compared/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('a hand-made accept-residual in the ledger is not a cap: --status stays FAIL until every remaining error has a class in the decisions file', () => {
  const root = project();
  const status = () => run(root, ['--status', '--page', 'https://example.com/', '--build', 'http://localhost:8791/home-proposed.html']);
  const ROUNDS_CLI = join(HERE, '..', '..', '..', 'replica', 'scripts', 'rounds.mjs');
  try {
    assert.equal(run(root).status, 2);
    const d = spawnSync(process.execPath, [ROUNDS_CLI, 'decide', 'stardust/chrome', '--stage', 'prototype', '--decision', 'accept-residual', '--reason', 'done with the header'], { cwd: root, encoding: 'utf8' });
    assert.equal(d.status, 0, d.stderr);
    let r = status();
    assert.equal(r.status, 2); assert.match(r.stdout, /^header contract: FAIL at this stage — closed in the ledger by accept-residual, but 2 of 2 error\(s\) have no class: record a class per remaining error in stardust\/chrome\/header-decisions\.json /);
    assert.equal(run(root).status, 6, 'and the comparison itself is refused');
    // a class written by hand into the verdict file is not one either
    const v = json(root, 'header-parity.json'); for (const f of v.findings) if (f.severity === 'error') f.classed = { class: 'owner', reason: 'by hand' };
    writeFileSync(join(root, 'stardust/chrome/header-parity.json'), JSON.stringify(v));
    assert.equal(status().status, 2);
    decisions(root, [{ finding: KEYS[0], class: 'owner', reason: 'the menu service' }]);
    assert.match(status().stdout, /but 1 of 2 error\(s\) have no class/);
    decisions(root, KEYS.map((k) => ({ finding: k, class: 'owner', reason: 'the menu service' })));
    r = status();
    assert.deepEqual([r.status, r.stdout.slice(0, 40)], [0, 'header contract: CAPPED at this stage — ']);
    rmSync(join(root, 'stardust/chrome/header-parity.json'));
    assert.match(status().stdout, /but no verdict file of the comparison/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('a source with no header: a contract with no root and no control is a contract, and a build without a header passes it', () => {
  const bare = (url) => ({ url, widths: { 1440: { root: null, controls: [], scroll: [], states: 0 }, 390: { root: null, controls: [], scroll: [], states: 0 } } });
  assert.deepEqual(compareDocs(bare('https://example.com/'), bare('http://localhost:8791/home-proposed.html')).findings, []);
  const root = project();
  try {
    writeFileSync(join(root, 'stardust/chrome/header-contract.json'), JSON.stringify(bare('https://example.com/')));
    writeFileSync(join(root, 'stardust/chrome/header-build.json'), JSON.stringify(bare('http://localhost:8791/home-proposed.html')));
    assert.equal(run(root).status, 0);
    const r = run(root, ['--status', '--page', 'https://example.com/', '--build', 'http://localhost:8791/home-proposed.html']);
    assert.deepEqual([r.status, r.stdout], [0, 'header contract: PASS at this stage (1 counted round)\n']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('--status: NOT RECORDED without a contract in a replica project, silent for another page; NOT COMPARED names the two commands; a pass or a capped stage exits 0', () => {
  const root = project();
  const status = (page, extra = []) => run(root, ['--status', '--page', page, '--build', 'http://localhost:8791/home-proposed.html', ...extra]);
  try {
    let r = status('https://example.com/');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /^header contract: NOT COMPARED at this stage — node .*chrome-explore\.mjs "http:\/\/localhost:8791\/home-proposed\.html" stardust\/chrome\/header-build\.json --width 1440 --max-requests 0 --pace-ms 0 --reload-pause-ms 0 && node .*chrome-compare\.mjs stardust\/chrome\/header-contract\.json stardust\/chrome\/header-build\.json --profile replica --json stardust\/chrome\/header-parity\.json\n$/);
    assert.ok(!existsSync(join(root, 'stardust/chrome/rounds.json')), '--status writes nothing');
    r = status('https://example.com/about');
    assert.deepEqual([r.status, r.stdout], [0, ''], 'the contract was recorded on another page');
    run(root);
    r = status('https://example.com/');
    assert.equal(r.status, 2); assert.match(r.stdout, /^header contract: FAIL at this stage — 1 counted round of 3, the last one a FAIL: fix the header, then node /);
    assert.equal(status('https://example.com/', ['--stage', 'local-build']).stdout.slice(0, 31), 'header contract: NOT COMPARED a', 'a comparison at another stage does not count');
    run(root); run(root);
    decisions(root, KEYS.map((k) => ({ finding: k, class: 'accept-residual', reason: 'the prototype carries no behaviour script' })));
    assert.equal(run(root).status, 2);
    r = status('https://example.com/');
    assert.deepEqual([r.status, r.stdout], [0, 'header contract: CAPPED at this stage — 3 counted rounds, closed by accept-residual: 2 header-contract error(s) classed (2 accept-residual) in stardust/chrome/header-decisions.json\n']);
    writeFileSync(join(root, 'stardust/chrome/rounds.json'), JSON.stringify({ version: 1, stages: { prototype: { rounds: [{ label: 'compare-1', at: '2026-11-20T10:00:00Z', verdict: 'pass', kind: 'first' }], decisions: [] } } }));
    r = status('https://example.com/');
    assert.deepEqual([r.status, r.stdout], [0, 'header contract: PASS at this stage (1 counted round)\n']);
    writeFileSync(join(root, 'stardust/chrome/rounds.json'), 'not json');
    assert.equal(status('https://example.com/').status, 1, 'an unreadable ledger is an error, never "compared"');
    rmSync(join(root, 'stardust/chrome/header-contract.json'));
    r = status('https://example.com/about');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /^header contract: NOT RECORDED — node .*chrome-explore\.mjs "https:\/\/example\.com\/about" stardust\/chrome\/header-contract\.json\n$/, 'a replica project with no contract: any page asks');
    for (const state of ['{ "flow": "reskin" }', null]) {
      if (state) writeFileSync(join(root, 'stardust/state.json'), state); else rmSync(join(root, 'stardust/state.json'));
      r = status('https://example.com/');
      assert.deepEqual([r.status, r.stdout], [0, ''], 'no contract outside a replica project: nothing to say');
    }
    writeFileSync(join(root, 'stardust/state.json'), '{ "flow": ');
    assert.equal(status('https://example.com/').status, 1, 'a state.json that cannot be read is an error, never silence');
    writeFileSync(join(root, 'stardust/state.json'), '{ "flow": "replica" }');
    assert.equal(run(root, ['--status']).status, 1, '--status needs --page and --build');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
check('a replica project whose copy has no replica scripts beside it compares nothing (exit 1)', () => {
  const { root, copy } = copyWithoutMaster();
  const proj = project();
  try {
    const r = run(proj, [], {}, join(copy, 'chrome-compare.mjs'));
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /^chrome-compare: the round cap could not be checked — rounds\.mjs not found \(looked in \.\.\/\.\.\/replica\/scripts\/ and \.\.\/replica\/\): copy the replica skill's scripts dir to stardust\/scripts\/replica\/ — so nothing is compared/);
    assert.ok(!existsSync(join(proj, 'stardust/chrome/header-parity.json')));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); }
});
check('a copy without the master scripts answers --help, no stack trace', () => {
  const { root, copy } = copyWithoutMaster();
  try {
    const r = spawnSync(process.execPath, [join(copy, 'chrome-compare.mjs'), '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes('    at '), r.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

process.exit(failed ? 1 : 0);
