#!/usr/bin/env node
// skills/diff/scripts/test/chrome-compare.test.mjs — the header-parity verdict from two chrome-explore records (no browser):
// pairing by name then family, a hover menu rebuilt as click-only, missing panel links, keyboard and close paths,
// motion and scroll states under `replica` only, search typeahead, and decisions: a site owner's in an attended run;
// in a hands-off run (state.json handsOff) an agent's too, with a reason of ≥ 40 characters, listed in decidedByAgent;
// the `decide` subcommand writes the agent's entry once; the one rule reads the same in --help and the three docs;
// a crop difference the hide list explains (panel tops a hidden region's height apart, shared area within the bar) is
// info with its evidence (the pixel part runs where pngjs + pixelmatch are installed);
// hide lists: records explored with different ones (or not the expected --hide / presence.json one) are one error; the
// site-wide stardust/replica/presence.json sets the expected list with no flag (and names itself in the verdict).
// Run: node plugins/stardust/skills/diff/scripts/test/chrome-compare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_RULE, applyDecisions, compareDocs, compareHide, decideEntry, findingKey, hideOffset, pairControls, visualFindings } from '../chrome-compare.mjs';

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

const KEY = 'state-missing@1440 search [type]';
const REASON = 'typeahead needs the source search backend: a host-bound feature, no build can answer it';
const errs = () => [{ id: 'state-missing', width: 1440, path: 'search', action: 'type', severity: 'error' }, { id: 'motion', width: 390, path: 'Open menu', severity: 'error' }];
const agentEntry = (more = {}) => ({ finding: KEY, decision: 'accept', reason: REASON, by: 'agent', at: '2026-10-18T10:00:00Z', ...more });
check('hands-off: an agent decision with a reason of ≥ 40 characters clears its error, marked as the agent\'s', () => {
  const out = applyDecisions(errs(), [agentEntry()], { handsOff: true });
  assert.deepEqual(out[0].decided, { decision: 'accept', by: 'agent', at: '2026-10-18T10:00:00Z', reason: REASON, agent: true });
  assert.equal(out[1].decided, undefined);
  assert.equal(out.length, 2, 'nothing reported as ignored');
  assert.ok(applyDecisions(errs(), [agentEntry({ reason: `  ${'y'.repeat(40)}  ` })], { handsOff: true })[0].decided, 'exactly 40 characters (trimmed) is enough');
});
check('attended (handsOff absent or false): the same agent decision is ignored and reported with the owner sentence', () => {
  for (const opts of [undefined, { handsOff: false }]) {
    const out = applyDecisions(errs(), [agentEntry()], opts);
    assert.equal(out[0].decided, undefined);
    const ignored = out.filter((x) => x.id === 'decision-invalid');
    assert.equal(ignored.length, 1);
    assert.match(ignored[0].detail, /^ignored: state-missing@1440 search \[type\] — an attended run: only the site owner clears a finding/);
  }
});
check('hands-off: a short reason, an unknown decision or a prefix* key from an agent is ignored and reported', () => {
  const out = applyDecisions(errs(), [agentEntry({ reason: 'x'.repeat(39) }), agentEntry({ decision: 'accepted' }), agentEntry({ finding: 'state-missing@1440*' })], { handsOff: true });
  assert.equal(out[0].decided, undefined);
  const why = out.filter((x) => x.id === 'decision-invalid').map((x) => [x.severity, x.detail]);
  assert.equal(why.length, 3);
  assert.ok(why.every(([s]) => s === 'warn'));
  assert.match(why[0][1], /a reason of at least 40 characters naming the evidence/);
  assert.match(why[1][1], /accept, fix-later or artefact/);
  assert.match(why[2][1], /one exact finding key per entry/);
});
check('hands-off: a site owner\'s entry for the same finding wins over the agent\'s', () => {
  const owner = { finding: KEY, decision: 'fix-later', reason: 'search is rebuilt next quarter', by: 'Site owner', at: '2026-10-18' };
  const out = applyDecisions(errs(), [agentEntry(), owner], { handsOff: true });
  assert.deepEqual(out[0].decided, { decision: 'fix-later', by: 'Site owner', at: '2026-10-18', reason: 'search is rebuilt next quarter' });
});
check('an agent named anywhere in `by` ("subagent", "the agent", " Agent", "migration bot", "AI") is the agent, never the owner', () => {
  for (const by of ['subagent', 'the agent', ' Agent', 'migration bot', 'AI', 'LLM', 'model']) {
    const wild = applyDecisions(errs(), [{ finding: 'state-missing*', decision: 'accept', by, at: 'x' }], { handsOff: true });
    assert.equal(wild[0].decided, undefined, `${by}: a prefix* from an agent clears nothing`);
    assert.equal(applyDecisions(errs(), [agentEntry({ by })], { handsOff: true })[0].decided.agent, true, by);
    assert.equal(applyDecisions(errs(), [agentEntry({ by })])[0].decided, undefined, `${by}: attended`);
  }
  assert.equal(applyDecisions(errs(), [agentEntry({ by: 'Site owner (marketing lead)' })])[0].decided.agent, undefined, 'an owner stays an owner');
});
check('a bare "*" key clears nothing for anyone (ignored and reported)', () => {
  const out = applyDecisions(errs(), [{ finding: '*', decision: 'accepted', by: 'Site owner', at: '2026-10-18' }]);
  assert.ok(out.every((f) => !f.decided));
  assert.match(out.find((x) => x.id === 'decision-invalid').detail, /^ignored: \* — /);
});
check('decideEntry: an earlier entry signed "subagent" is the agent\'s — replaced, not kept as the owner\'s', () => {
  const doc = { decisions: [{ finding: KEY, decision: 'accept', reason: REASON, by: 'subagent', at: '2026-10-17' }] };
  const { doc: next, status } = decideEntry(doc, { finding: KEY, decision: 'artefact', reason: REASON, at: '2026-10-18' });
  assert.equal(status, 'replaced');
  assert.deepEqual(next.decisions, [{ finding: KEY, decision: 'artefact', reason: REASON, by: 'agent', at: '2026-10-18' }]);
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

// hide-list offset: an in-flow region hidden after load leaves a panel the source's script pinned at the region's height
const shot = (d, rect) => { const x = structuredClone(d); Object.assign(x.widths[1440].controls[0].actions.hover, { shot: 'shop.png' }); x.widths[1440].controls[0].actions.hover.panel.rect = rect; return x; };
check('compareDocs: each crop pair carries both panel rects and the hidden regions\' heights at its width (either record, h > 0)', () => {
  const s = shot(hid(source, ['.geo-bar']), [0, 160, 1440, 600]); s.hide.perWidth = { 1440: [{ sel: '.geo-bar', n: 1, h: 88 }] };
  const b = shot(hid(source, ['.geo-bar']), [0, 72, 1440, 688]); b.hide.perWidth = { 1440: [{ sel: '.geo-bar', n: 0, h: 0 }] };
  const [pair] = compareDocs(s, b).visual;
  assert.deepEqual([pair.srcRect, pair.buildRect, pair.hidden], [[0, 160, 1440, 600], [0, 72, 1440, 688], [{ sel: '.geo-bar', h: 88 }]]);
});
check('hideOffset: panel tops 88 px apart = a hidden region\'s height (±2 px), same panel width → the offset, judged on the shared area', () => {
  const hidden = [{ sel: '.geo-bar', h: 88 }];
  assert.deepEqual(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 73, 1440, 688], hidden, shared: 0.004, bar: 0.02 }), { region: '.geo-bar', h: 88, dy: 87, shared: 0.004, within: true });
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 72, 1440, 688], hidden, shared: 0.05, bar: 0.02 }).within, false, 'a shared area over the bar stays an error');
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 110, 1440, 688], hidden, shared: 0, bar: 0.02 }), null, '50 px is no hidden height');
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 72, 1200, 688], hidden, shared: 0, bar: 0.02 }), null, 'another panel width is not an offset');
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 72, 1440, 688], hidden: [], shared: 0, bar: 0.02 }), null, 'nothing hidden');
  assert.equal(hideOffset({ srcRect: null, buildRect: [0, 72, 1440, 688], hidden, shared: 0, bar: 0.02 }), null);
});
check('hideOffset: the shift explains at most |dy| px lost off the lower panel — a taller or much shorter panel is no offset', () => {
  const hidden = [{ sel: '.geo-bar', h: 88 }];
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 120], buildRect: [0, 72, 1440, 600], hidden, shared: 0, bar: 0.02 }), null, 'the build 480 px taller');
  assert.equal(hideOffset({ srcRect: [0, 160, 1440, 600], buildRect: [0, 72, 1440, 150], hidden, shared: 0.001, bar: 0.02 }), null, 'the lower panel is the taller one');
  assert.equal(hideOffset({ srcRect: [0, 88, 1440, 812], buildRect: [0, 0, 1440, 854], hidden, shared: 0.001, bar: 0.02 }).within, true, 'clipped 42 px by the viewport after an 88 px shift');
});
const deps = await (async () => { try { const { createRequire } = await import('node:module'); const req = createRequire(join(process.cwd(), 'package.json')); const m = await import(req.resolve('pngjs')); req.resolve('pixelmatch'); return { PNG: m.PNG || m.default.PNG }; } catch { return null; } })();
if (!deps) console.log('skip  hide-offset pixels: visualFindings and the CLI ⚪ line (pngjs + pixelmatch not installed where this runs)');
else {
  const shots = mkdtempSync(join(tmpdir(), 'chrome-crops-'));
  const png = (name, w, h, paint) => { const p = new deps.PNG({ width: w, height: h }); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const i = (y * w + x) * 4; const c = paint(x, y); p.data[i] = c; p.data[i + 1] = c; p.data[i + 2] = c; p.data[i + 3] = 255; } writeFileSync(join(shots, name), deps.PNG.sync.write(p)); };
  const stripes = (x, y) => ((Math.floor(y / 10) % 2) ? 40 : 220);
  png('src.png', 100, 120, stripes); png('build.png', 100, 208, stripes); png('other.png', 100, 208, (x, y) => (y < 60 ? 0 : stripes(x, y)));
  const pair = (build) => ({ width: 1440, path: 'Shop', action: 'hover', src: 'src.png', build, srcRect: [0, 160, 100, 120], buildRect: [0, 72, 100, 208], hidden: [{ sel: '.geo-bar', h: 88 }] });
  const out = await visualFindings([pair('build.png'), pair('other.png')], { srcDir: shots, buildDir: shots, bar: 0.02 });
  check('visualFindings: a crop whose size differs by the hide offset but whose shared area matches is info, with its evidence', () => {
    assert.deepEqual([out[0].id, out[0].severity], ['panel-visual', 'info']);
    assert.match(out[0].detail, /shared area 0\.0%.*the source panel sits 88px lower than the build's — the height of the hidden region \.geo-bar \(88px\): a hide-list offset, a measurement artefact/);
    assert.deepEqual(out[0].evidence, { kind: 'hide-offset', region: '.geo-bar', h: 88, dy: 88, shared: 0 });
    assert.equal(out[0].srcRect, undefined, 'the pair\'s inputs are not in the finding');
  });
  check('visualFindings: the same offset with a differing shared area stays an error, naming the offset', () => {
    assert.equal(out[1].severity, 'error');
    assert.match(out[1].detail, /the offset equals the hidden region \.geo-bar \(88px\), but the shared area differs by \d+\.\d%/);
  });
  rmSync(shots, { recursive: true });
}

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
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(v, 'utf8'))), ['tool', 'at', 'source', 'build', 'profile', 'bar', 'widths', 'handsOff', 'counts', 'decidedByAgent', 'findings']);
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

// header decisions on the CLI: a build without the typeahead has one error, `state-missing@1440 search [type]`
const noTypeahead = structuredClone(source); noTypeahead.widths[1440].controls[1].search.typeahead = { links: 0, options: 0 };
const noTa = put('no-typeahead.json', noTypeahead);
const projectWith = (name, state, decisions) => {
  const root = join(dir, name);
  mkdirSync(join(root, 'stardust', 'chrome'), { recursive: true });
  if (state) writeFileSync(join(root, 'stardust', 'state.json'), JSON.stringify(state));
  if (decisions) writeFileSync(join(root, 'stardust', 'chrome', 'header-decisions.json'), JSON.stringify({ decisions }));
  return root;
};
check('CLI hands-off: an agent decision counts as decided (exit 0); the verdict and the printed report list it in decidedByAgent', () => {
  const root = projectWith('hands-off', { handsOff: true, flow: 'replica' }, [agentEntry()]);
  const v = join(root, 'parity.json');
  const r = cliIn(root, plain, noTa, '--json', v);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, `🔵 decided by the agent: ${KEY} — accept: ${REASON} (${agentEntry().at})\n`
    + `chrome-compare: 0 error(s), 0 warning(s), 1 decided (1 by the agent, hands-off — for the owner's review) (profile replica, widths 1440) → ${v}\n`);
  const verdict = JSON.parse(readFileSync(v, 'utf8'));
  assert.equal(verdict.handsOff, true);
  assert.deepEqual(verdict.counts, { error: 0, warn: 0, info: 0, decided: 1, decidedByAgent: 1 });
  assert.deepEqual(verdict.decidedByAgent, [{ key: KEY, decision: 'accept', reason: REASON, at: agentEntry().at }]);
  assert.equal(verdict.findings.find((f) => f.key === KEY).decided.agent, true, 'done-check reads findings[].decided');
});
check('CLI attended (--state with handsOff false, or no state file): the agent decision is ignored and reported; the error stays (exit 2)', () => {
  const root = projectWith('attended', { handsOff: false }, [agentEntry()]);
  const v = join(root, 'parity.json');
  const r = cliIn(root, plain, noTa, '--json', v);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^🔴 state-missing@1440 search \[type\] — /m);
  assert.match(r.stdout, /^🟡 decision-invalid@0 \(decisions\) — ignored: state-missing@1440 search \[type\] — an attended run: only the site owner clears a finding/m);
  assert.doesNotMatch(r.stdout, /decided by the agent/);
  const verdict = JSON.parse(readFileSync(v, 'utf8'));
  assert.deepEqual([verdict.handsOff, verdict.counts, verdict.decidedByAgent], [false, { error: 1, warn: 1, info: 0, decided: 0, decidedByAgent: 0 }, []]);
  const hands = projectWith('state-flag', { handsOff: true }, null);
  assert.equal(cliIn(root, plain, noTa, '--state', join(hands, 'stardust', 'state.json')).status, 0, '--state names the state file');
  assert.equal(cliIn(projectWith('no-state', null, [agentEntry()]), plain, noTa).status, 2, 'no state file: attended');
});
check('CLI hands-off: an agent entry with a 39-character reason is ignored and reported; the error stays (exit 2)', () => {
  const root = projectWith('short-reason', { handsOff: true }, [agentEntry({ reason: 'z'.repeat(39) })]);
  const r = cliIn(root, plain, noTa);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^🟡 decision-invalid@0 \(decisions\) — ignored: .*a reason of at least 40 characters/m);
});
check('decide (hands-off): writes the agent-signed entry once — a repeat leaves the file byte-identical; the next compare counts it decided', () => {
  const root = projectWith('decide', { handsOff: true }, null);
  const file = join(root, 'stardust', 'chrome', 'header-decisions.json');
  const r = cliIn(root, 'decide', KEY, '--decision', 'artefact', '--reason', REASON);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chrome-compare decide: recorded state-missing@1440 search \[type\] — artefact \(by agent\) → stardust\/chrome\/header-decisions\.json/m);
  const first = readFileSync(file, 'utf8');
  const { decisions } = JSON.parse(first);
  assert.equal(decisions.length, 1);
  assert.deepEqual({ ...decisions[0], at: 'x' }, { finding: KEY, decision: 'artefact', reason: REASON, by: 'agent', at: 'x' });
  assert.match(decisions[0].at, /^\d{4}-\d\d-\d\dT/);
  const again = cliIn(root, 'decide', KEY, '--decision', 'artefact', '--reason', REASON);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already recorded/);
  assert.equal(readFileSync(file, 'utf8'), first);
  assert.equal(cliIn(root, plain, noTa).status, 0);
});
check('decide: refused in an attended run (exit 3, the owner sentence, nothing written); a short reason, a bad decision or a prefix* key is a usage error', () => {
  const root = projectWith('decide-attended', { handsOff: false }, null);
  const file = join(root, 'stardust', 'chrome', 'header-decisions.json');
  const r = cliIn(root, 'decide', KEY, '--decision', 'accept', '--reason', REASON);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /an attended run: only the site owner clears a finding/);
  assert.equal(existsSync(file), false);
  const hands = projectWith('decide-usage', { handsOff: true }, null);
  for (const args of [[KEY, '--decision', 'accept', '--reason', 'too short'], [KEY, '--decision', 'accepted', '--reason', REASON], ['state-missing@1440*', '--decision', 'accept', '--reason', REASON], ['--decision', 'accept', '--reason', REASON]]) {
    const u = cliIn(hands, 'decide', ...args);
    assert.equal(u.status, 1, `${args.join(' ')}: ${u.stdout}${u.stderr}`);
  }
  assert.equal(existsSync(join(hands, 'stardust', 'chrome', 'header-decisions.json')), false);
});
if (deps) {
  check('CLI: a hide-offset crop is printed as a ⚪ info line and counted as info, never an error (exit 0)', () => {
    const root = projectWith('offset', null, null);
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules')); writeFileSync(join(root, 'package.json'), '{}');
    const sd = join(root, 'src-shots'); const bd = join(root, 'build-shots'); mkdirSync(sd); mkdirSync(bd);
    const png = (f, h) => { const p = new deps.PNG({ width: 100, height: h }); for (let i = 0; i < p.data.length; i += 4) { const c = (Math.floor(i / 400 / 10) % 2) ? 40 : 220; p.data[i] = c; p.data[i + 1] = c; p.data[i + 2] = c; p.data[i + 3] = 255; } writeFileSync(f, deps.PNG.sync.write(p)); };
    png(join(sd, 'shop.png'), 120); png(join(bd, 'shop.png'), 208);
    const s = shot(hid(source, ['.geo-bar']), [0, 160, 100, 120]); s.hide.perWidth = { 1440: [{ sel: '.geo-bar', n: 1, h: 88 }] }; s.shots = sd;
    const b = shot(hid(source, ['.geo-bar']), [0, 72, 100, 208]); b.shots = bd;
    const v = join(root, 'parity.json');
    const r = cliIn(root, put('offset-src.json', s), put('offset-build.json', b), '--json', v);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^⚪ panel-visual@1440 Shop \[hover\] — open-state crop differs by 42\.3% .*a hide-list offset, a measurement artefact$/m);
    assert.match(r.stdout, /^chrome-compare: 0 error\(s\), 0 warning\(s\), 1 info, 0 decided \(profile replica, widths 1440\) → /m);
    const verdict = JSON.parse(readFileSync(v, 'utf8'));
    assert.equal(verdict.counts.info, 1);
    assert.equal(verdict.findings[0].evidence.kind, 'hide-offset');
  });
}
check('the one rule: DECISION_RULE reads the same in --help, diff/SKILL.md, the handoff contract and replica/SKILL.md', () => {
  const norm = (s) => s.replace(/\s+/g, ' ');
  assert.ok(norm(cli('--help').stdout).includes(norm(DECISION_RULE)), '--help');
  const docs = ['../../SKILL.md', '../../../replica/SKILL.md', '../../../replica/reference/handoff-contract.md'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
  if (!existsSync(docs[0])) return; // a project copy ships the scripts without the docs
  for (const f of docs) assert.ok(norm(readFileSync(f, 'utf8')).includes(norm(DECISION_RULE)), f);
});
rmSync(dir, { recursive: true });
process.exit(failed ? 1 : 0);
