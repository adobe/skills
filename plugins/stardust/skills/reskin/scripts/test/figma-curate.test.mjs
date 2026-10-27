#!/usr/bin/env node
// skills/reskin/scripts/test/figma-curate.test.mjs — curate (pure): the reference curation of the
// synthetic kit resolves all 13 default-probe paths to plain computed-style strings, normalizations
// apply where scoped, curations and suspects are recorded, every assigned path cites its node,
// donor-modules.md renders the contract's table with evidence, and every failure is a RulesError
// that names the rule (unresolved from, unmapped probe path, unknown key or kind, a module with no
// screenshot, mixed capture versions). Deterministic. Run: node <this file>.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFoundation, PROBE_PATHS, RECOMMENDED_PATHS } from '../figma/foundation.mjs';
import { curate } from '../figma/curate.mjs';
import { validateRules } from '../figma/rules.mjs';
import { RulesError } from '../figma/errors.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'figma-kit');
const read = (f) => JSON.parse(readFileSync(join(KIT, f), 'utf8'));
const { foundation, moduleCandidates } = buildFoundation({ file: read('file.json'), nodes: read('nodes.json'), frameIds: ['1:2', '1:9'] });
const RULES = read('curation-rules.json');
const manifest = { fileKey: 'AbCdEf1234567890', nodeId: '0:1', version: 'v1', capturedAt: '2026-01-02T03:04:05Z' };
const screenshotIndex = {
  home: { node: '1:2', width: 1440, height: 1840, version: 'v1', renderable: true },
  article: { node: '1:9', width: 1440, height: 1800, version: 'v1', renderable: true },
};
const donorUrl = 'https://www.figma.com/design/AbCdEf1234567890?node-id=0-1';
const rules = (patch = (r) => r) => patch(structuredClone(RULES));
const inputs = (r = rules(), extra = {}) => ({ foundation, moduleCandidates, rules: r, manifest, screenshotIndex, donorUrl, ...extra });
const get = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const leaves = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
const rulesError = (fn, re) => assert.throws(fn, (e) => { assert.ok(e instanceof RulesError, `not a RulesError: ${e.message}`); assert.equal(e.exitCode, 1); if (re) assert.match(e.message, re); return true; });

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const out = curate(inputs());
const t = out.donorTokens;

check('reference curation: all 13 paths resolve, coverage.asserted + absent = 13', () => {
  for (const p of PROBE_PATHS) assert.equal(typeof get(t, p), 'string', `${p} = ${get(t, p)}`);
  assert.equal(t.coverage.asserted, 13);
  assert.equal(t.coverage.asserted + t.coverage.absent.filter((a) => a.probe).length, 13);
});
check('probe values are the computed-style strings the probe asserts', () => {
  assert.deepEqual(
    PROBE_PATHS.map((p) => get(t, p)),
    ['rgb(255, 255, 255)', 'rgb(26, 26, 26)', 'rgb(31, 58, 95)', 'Inter', '18px', '700', 'rgb(31, 58, 95)', 'rgb(255, 255, 255)', '8px', '12px 24px', '16px', '1200px', '80px'],
  );
});
check('key order and provenance', () => {
  assert.deepEqual(Object.keys(t), ['_provenance', 'donor', 'curatedFrom', 'note', 'palette', 'type', 'layout', 'buttons', 'cards', 'radii', 'shadows', 'motifs', 'nodeRefs', 'coverage']);
  assert.equal(t._provenance.writtenBy, 'stardust:reskin/figma-donor.mjs');
  assert.equal(t._provenance.writtenAt, '2026-01-02T03:04:05Z');
  assert.equal(t.donor, donorUrl);
  assert.equal(t.curatedFrom, 'reskin/curation-rules.json@v1; canon-source/foundation (figma version v1)');
  assert.match(t.note, /pages: Home \(node 1:2, 1440px\)/);
  assert.deepEqual(Object.keys(t.type).slice(0, 2), ['family', 'familyNote']);
  assert.match(t.type.familyNote, /local fallback/);
  assert.match(t.type.familyNote, /"Inter Display" → "Inter"/);
});
check('byte-identical on two runs', () => assert.equal(JSON.stringify(curate(inputs())), JSON.stringify(out)));
check('one rule changed → only dependent paths change', () => {
  const t2 = curate(inputs(rules((r) => { r.roles['palette.pageBg'] = { from: 'colors/rgb-247-247-245', evidence: '1:9' }; return r; }))).donorTokens;
  const a = Object.fromEntries(leaves(t)); const b = Object.fromEntries(leaves(t2));
  const changed = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  assert.ok(changed.length > 0);
  assert.ok(changed.every((k) => k === 'palette.pageBg' || k.startsWith('nodeRefs.palette.pageBg.')), changed.join(', '));
});
check('unresolved from → RulesError naming the rule', () => {
  rulesError(() => curate(inputs(rules((r) => { r.roles['palette.bodyFg'] = { from: 'colors/no-such-color' }; return r; }))), /palette\.bodyFg.*colors\/no-such-color/);
  rulesError(() => validateRules(rules((r) => { r.roles['buttons.primary'] = { component: 'nope' }; return r; }), { foundation, moduleCandidates, screenshotIndex }), /components\/nope/);
});
check('a probe path neither mapped nor absent → RulesError listing it', () => {
  rulesError(() => curate(inputs(rules((r) => { delete r.roles['layout.sectionPaddingY']; return r; }))), /layout\.sectionPaddingY/);
});
check('absent with a why: listed in coverage, not asserted; absent without a why is an error', () => {
  const t2 = curate(inputs(rules((r) => { r.roles['layout.sectionPaddingY'] = { absent: 'sections pad on inner frames' }; return r; }))).donorTokens;
  assert.equal(t2.coverage.asserted, 12);
  assert.deepEqual(t2.coverage.absent, [{ path: 'layout.sectionPaddingY', why: 'sections pad on inner frames', probe: true }]);
  assert.equal(get(t2, 'layout.sectionPaddingY'), undefined);
  rulesError(() => curate(inputs(rules((r) => { r.roles['layout.sectionPaddingY'] = { absent: '' }; return r; }))), /layout\.sectionPaddingY/);
});
check('explicit absent wins over an ancestor object', () => {
  const t2 = curate(inputs(rules((r) => { r.roles['buttons.primary.padding'] = { absent: 'padding differs per breakpoint' }; return r; }))).donorTokens;
  assert.equal(t2.buttons.primary.padding, undefined);
  assert.equal(t2.buttons.primary.background, 'rgb(31, 58, 95)');
  assert.equal(t2.coverage.asserted, 12);
});
check('a mapped component with no value for a probe field names the field and its kind', () => {
  rulesError(() => curate(inputs(rules((r) => { r.roles['buttons.primary'] = { component: 'button-secondary' }; return r; }))), /buttons\.primary\.background.*NONE/);
});
check('a button leaf can come from a single-value record (the fallback for unusual button layouts)', () => {
  const t2 = curate(inputs(rules((r) => {
    r.roles['buttons.primary'] = { component: 'button-secondary' };
    r.roles['buttons.primary.background'] = { from: 'colors/brand-navy', evidence: '1:20' };
    r.roles['buttons.primary.borderRadius'] = { from: 'radii/radius-8', evidence: '1:20' };
    return r;
  }))).donorTokens;
  assert.equal(t2.buttons.primary.background, 'rgb(31, 58, 95)');
  assert.equal(t2.buttons.primary.borderRadius, '8px');
  assert.equal(t2.coverage.asserted, 13);
  rulesError(() => curate(inputs(rules((r) => { r.roles['palette.pageBg'] = { from: 'colors/brand-navy', field: 'background' }; return r; }))), /single value/);
});
check('recommended paths are optional: the unmapped ones are listed as missing, curate still succeeds', () => {
  assert.equal(RECOMMENDED_PATHS.length, 7);
  assert.equal(t.buttons.primary.height, '48px', 'buttons.primary from a component carries its box height');
  assert.equal(t.nodeRefs['buttons.primary.height'].node, '1:20');
  assert.deepEqual(t.cards, {});
  assert.deepEqual(t.coverage.recommended, {
    curated: ['buttons.primary.height'],
    missing: ['cards.primary.background', 'cards.primary.borderRadius', 'cards.primary.padding', 'cards.primary.titleColor', 'layout.mobile.sectionPaddingY', 'layout.mobile.gutter'],
  });
  const t2 = curate(inputs(rules((r) => { r.roles['cards.primary'] = { absent: 'the kit has no card component' }; r.roles['layout.mobile.gutter'] = { absent: 'no mobile frame' }; return r; }))).donorTokens;
  assert.deepEqual(t2.coverage.recommended.missing, ['layout.mobile.sectionPaddingY']);
  assert.equal(t2.coverage.asserted, 13);
});
check('cards is a group: cards.primary from a component resolves like buttons.primary, titleColor from its label color', () => {
  // The fixture kit has no card component; link-cta stands in for one.
  const o2 = curate(inputs(rules((r) => {
    r.roles['cards.primary'] = { component: 'link-cta', evidence: '2:9' };
    r.roles['layout.mobile.sectionPaddingY'] = { from: 'spacing/pad-64', evidence: '1:7' };
    r.roles['layout.mobile.gutter'] = { from: 'spacing/pad-24', evidence: '1:7' };
    return r;
  })));
  const t2 = o2.donorTokens;
  assert.match(o2.designMd, /\n {2}card-primary:\n {4}backgroundColor: .+\n {4}textColor: .+\n {4}rounded: "4px"\n {4}padding: "8px 16px"\n/);
  assert.match(o2.designMd, /\n {2}button-primary:\n(?: {4}.+\n)* {4}height: "48px"\n/);
  assert.deepEqual(
    [t2.cards.primary.background, t2.cards.primary.borderRadius, t2.cards.primary.padding, t2.cards.primary.titleColor],
    ['rgb(26, 26, 26)', '4px', '8px 16px', 'rgb(255, 255, 255)'],
  );
  assert.equal(t2.nodeRefs['cards.primary.titleColor'].node, 'I2:9;6:3');
  assert.equal(t2.nodeRefs['cards.primary.padding'].node, 'I2:9;6:2');
  assert.deepEqual([t2.layout.mobile.sectionPaddingY, t2.layout.mobile.gutter], ['64px', '24px']);
  assert.deepEqual(t2.coverage.recommended, { curated: RECOMMENDED_PATHS, missing: [] });
  const leaf = curate(inputs(rules((r) => {
    r.roles['cards.primary.titleColor'] = { from: 'components/link-cta', evidence: '2:9' };
    r.roles['cards.primary.background'] = { from: 'colors/rgb-247-247-245', evidence: '1:7' };
    return r;
  }))).donorTokens;
  assert.equal(leaf.cards.primary.titleColor, 'rgb(255, 255, 255)');
  assert.equal(leaf.cards.primary.background, 'rgb(247, 247, 245)');
  rulesError(() => curate(inputs(rules((r) => { r.roles['cards.primary.titleColor'] = { from: 'typography/body-regular' }; return r; }))), /cards\.primary\.titleColor.*has no color \(cards\.primary\.titleColor reads the record's color; set "field"/);
  rulesError(() => curate(inputs(rules((r) => { r.roles['tiles.primary'] = { component: 'link-cta' }; return r; }))), /cards/);
});
check('curations[] overrides value and records nodeRefs[path].curated', () => {
  const t2 = curate(inputs(rules((r) => { r.curations = [{ path: 'type.h2.fontWeight', to: '600', rule: 'kit spec table: h2 is semibold', evidence: '2:6' }]; return r; }))).donorTokens;
  assert.equal(t2.type.h2.fontWeight, '600');
  assert.deepEqual(t2.nodeRefs['type.h2.fontWeight'].curated, { from: '700', rule: 'kit spec table: h2 is semibold', evidence: '2:6' });
  rulesError(() => curate(inputs(rules((r) => { r.curations = [{ path: 'type.h2.fontWeight', to: '600' }]; return r; }))), /curations\[0\].*rule/);
});
check('normalizations: familyEquivalence, weightMap, lineHeightUnitless, letterSpacingEm applied where scoped', () => {
  assert.equal(t.type.display.fontFamily, 'Inter');
  assert.equal(t.buttons.primary.fontWeight, '500');
  assert.equal(t.type.display.lineHeight, '1.143');
  assert.equal(t.type.h2.lineHeight, '1.2');
  assert.equal(t.type.body.lineHeight, '28px', 'lineHeightUnitless is scoped to display and h2');
  assert.equal(t.type.display.letterSpacing, '-0.02em');
  assert.deepEqual(t.nodeRefs['type.display.lineHeight'].normalizedBy, ['display-lh']);
  rulesError(() => curate(inputs(rules((r) => { r.normalizations.push({ id: 'x', kind: 'kerning', params: {} }); return r; }))), /kerning/);
  rulesError(() => curate(inputs(rules((r) => { r.normalizations.push({ id: 'y', kind: 'weightMap', params: {} }); return r; }))), /weightMap.*map/);
});
check('type.display.textAlign: majority textAlignHorizontal (by characters) of the display record; absent when Figma gives none; an explicit role wins', () => {
  assert.equal(t.type.display.textAlign, 'left');
  const strip = (n) => { if (n.style) delete n.style.textAlignHorizontal; (n.children || []).forEach(strip); };
  const bare = read('nodes.json'); Object.values(bare.nodes || bare).forEach((v) => v?.document && strip(v.document));
  const f0 = buildFoundation({ file: read('file.json'), nodes: bare, frameIds: ['1:2', '1:9'] });
  assert.equal(curate({ ...inputs(), ...f0 }).donorTokens.type.display.textAlign, undefined);
  const file = read('file.json'); let tagged = 0;
  const walk = (n) => { if (n.type === 'TEXT' && n.style) { n.style.textAlignHorizontal = tagged++ % 3 ? 'CENTER' : 'LEFT'; } (n.children || []).forEach(walk); };
  walk(file.document);
  const nodes = read('nodes.json'); Object.values(nodes.nodes || nodes).forEach((v) => v?.document && walk(v.document));
  const f2 = buildFoundation({ file, nodes, frameIds: ['1:2', '1:9'] });
  const t2 = curate({ ...inputs(), foundation: f2.foundation, moduleCandidates: f2.moduleCandidates }).donorTokens;
  const rec = Object.values(f2.foundation.typography).find((r) => r.node === t2.nodeRefs['type.display.textAlign']?.node);
  assert.ok(rec?.align, 'display record carries an align tally');
  const [want] = Object.entries(rec.align).sort(([, a], [, b]) => b - a)[0];
  assert.equal(t2.type.display.textAlign, want);
  assert.equal(t2.nodeRefs['type.display.textAlign'].derived, 'majority by characters');
  const t3 = curate({ ...inputs(rules((r) => { r.roles['type.display.textAlign'] = { absent: 'kit sets no alignment' }; return r; })), foundation: f2.foundation, moduleCandidates: f2.moduleCandidates }).donorTokens;
  assert.equal(t3.type.display.textAlign, undefined);
});
check('layout.navAlign: majority of the frames\' measured header rows, with evidence; none without rows; absent wins', () => {
  const withRows = (aligns) => ({ ...moduleCandidates, frames: moduleCandidates.frames.map((f, i) => ({ ...f, headerRows: aligns[i] ? [{ node: `H${i}`, menu: `M${i}`, align: aligns[i], offset: 0, width: 1180 }] : [] })) });
  const t1 = curate({ ...inputs(), moduleCandidates: withRows(['center', 'center']) }).donorTokens;
  assert.equal(t1.layout.navAlign, 'center');
  assert.equal(t1.nodeRefs['layout.navAlign'].node, 'H0');
  assert.equal(t1.nodeRefs['layout.navAlign'].derived, 'majority of desktop header rows');
  assert.equal(curate({ ...inputs(), moduleCandidates: withRows([null, null]) }).donorTokens.layout.navAlign, undefined);
  const t3 = curate({ ...inputs(rules((r) => { r.roles['layout.navAlign'] = { absent: 'no header in the kit' }; return r; })), moduleCandidates: withRows(['end', 'end']) }).donorTokens;
  assert.equal(t3.layout.navAlign, undefined);
});
check('nodeRefs cite the node that paints each value', () => {
  assert.deepEqual(t.nodeRefs['palette.pageBg'], { node: '1:2', figma: { color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }, via: 'rest' });
  assert.equal(t.nodeRefs['buttons.primary.color'].node, 'I1:20;3:5');
  assert.equal(t.nodeRefs['buttons.primary.padding'].node, '1:20');
  assert.deepEqual(t.nodeRefs['buttons.primary.padding'].figma, [12, 24, 12, 24]);
  for (const p of PROBE_PATHS) assert.match(t.nodeRefs[p]?.node ?? '', /^I?\d+:\d+/, p);
});
check('suspects are listed, values kept', () => {
  assert.deepEqual(t.coverage.suspect, [{ path: 'buttons.primary.color', why: 'one Primary instance overrides its label color (I1:7;5:6)' }]);
  assert.equal(t.buttons.primary.color, 'rgb(255, 255, 255)');
});
check('radii and shadows from roles; motifs mechanical then authored', () => {
  assert.deepEqual(t.radii, { card: '12px 12px 0px 0px', button: '8px' });
  assert.deepEqual(t.shadows, { cardResting: 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px' });
  assert.deepEqual(t.motifs, ['gradient background (GRADIENT_LINEAR) on Hero, home, node 1:3', 'calm vertical rhythm: every band pads 80px top and bottom']);
});
check('no roles for radii or shadows → every foundation record by key', () => {
  const t2 = curate(inputs(rules((r) => { delete r.roles['radii.card']; delete r.roles['radii.button']; delete r.roles['shadows.cardResting']; return r; }))).donorTokens;
  assert.deepEqual(t2.radii, { 'radius-8': '8px', 'radius-12-12-0-0': '12px 12px 0px 0px', 'radius-4': '4px' });
  assert.deepEqual(t2.shadows, { 'elevation-card': 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px' });
});
check('radii or shadows marked absent are not resurrected by the every-record fallback: coverage, tokens and nodeRefs agree', () => {
  const only = (group) => (r) => {
    for (const k of Object.keys(r.roles)) if (k.startsWith(`${group}.`)) delete r.roles[k];
    return r;
  };
  const radii = curate(inputs(rules((r) => { only('radii')(r); r.roles['radii.radius-8'] = { absent: 'intentionally excluded' }; return r; }))).donorTokens;
  assert.deepEqual(radii.radii, { 'radius-12-12-0-0': '12px 12px 0px 0px', 'radius-4': '4px' });
  assert.deepEqual(radii.coverage.absent, [{ path: 'radii.radius-8', why: 'intentionally excluded', probe: false }]);
  assert.deepEqual(Object.keys(radii.nodeRefs).filter((k) => k.startsWith('radii.')), ['radii.radius-12-12-0-0', 'radii.radius-4']);
  const shadows = curate(inputs(rules((r) => { only('shadows')(r); r.roles['shadows.elevation-card'] = { absent: 'flat design' }; return r; }))).donorTokens;
  assert.deepEqual(shadows.shadows, {});
  assert.deepEqual(shadows.coverage.absent, [{ path: 'shadows.elevation-card', why: 'flat design', probe: false }]);
  assert.deepEqual(Object.keys(shadows.nodeRefs).filter((k) => k.startsWith('shadows.')), []);
  assert.deepEqual(shadows.radii, { card: '12px 12px 0px 0px', button: '8px' }, 'the other group is untouched');
});
check('every value in palette/type/layout/buttons is a plain string', () => {
  for (const g of ['palette', 'type', 'layout', 'buttons']) for (const [k, v] of leaves(t[g])) assert.equal(typeof v, 'string', `${g}.${k}`);
});
check('mixed versions (manifest v2, screenshot index v1) → RulesError "re-run capture --refresh"', () => {
  rulesError(() => curate(inputs(rules(), { manifest: { ...manifest, version: 'v2' } })), /capture --refresh/);
});
check('donor-modules.md: provenance first, table, excluded row and Notes line; every row cites a screenshot and node', () => {
  const md = out.donorModulesMd;
  const lines = md.trimEnd().split('\n');
  assert.equal(lines[0], '<!-- stardust:provenance');
  assert.ok(md.includes('| # | Module | EDS block | Where seen | Description |\n|---|--------|-----------|-----------|-------------|'));
  assert.ok(md.includes('| M1 | Gradient hero | hero (gradient) | canon-source/assets/screenshots/home.png · node 1:3 | anatomy: display headline + lede + primary and secondary CTA; components: Button |'));
  assert.ok(md.includes('| M2 | Feature grid | feature-grid | canon-source/assets/screenshots/home.png · node 1:7 | anatomy: section title + feature copy + card (label, CTA); variants: Show heading; components: Feature Grid, Button |'));
  assert.ok(md.includes('| — | Related | — | canon-source/assets/screenshots/article.png · node 2:8 | excluded — do not develop: a second instance of the feature grid; M2 covers it |'));
  for (const row of lines.filter((l) => /^\| (M\d+[a-z]?|—) \|/.test(l))) assert.match(row, /screenshots\/[a-z0-9-]+\.png · node I?\d+:\d+/);
  assert.equal(lines.at(-1), '**Notes for reskin:** sentence-case headings; navy and off-white bands alternate; buttons are 8px rounded with semibold labels');
});
check('donor-modules.md: the EDS block column is deploy Step 2 (eds-map.mjs) unless a module pins eds', () => {
  const md = curate(inputs(rules((r) => { r.modules[0].name = 'Q&A'; r.modules[1].eds = { block: null, variant: null }; return r; }))).donorModulesMd;
  assert.ok(md.includes('| M1 | Q&A | accordion | canon-source'), md);
  assert.ok(md.includes('| M2 | Feature grid | default content | canon-source'), md);
  rulesError(() => curate(inputs(rules((r) => { r.modules[0].eds = { block: '' }; return r; }))), /M1: eds must be/);
});
check('a module without a screenshot or with a bad frame → RulesError (evidence-bound)', () => {
  rulesError(() => curate(inputs(rules(), { screenshotIndex: { ...screenshotIndex, article: { ...screenshotIndex.article, renderable: false } } })), /M4.*screenshot/);
  rulesError(() => curate(inputs(rules((r) => { r.modules[0].frame = '9:9'; return r; }))), /M1.*9:9/);
  rulesError(() => curate(inputs(rules((r) => { r.modules[1].id = 'M1'; return r; }))), /duplicate.*M1/);
});
check('a module whose frame holds only childless instances is recorded hollow in coverage and its row', () => {
  assert.equal(t.coverage.hollow, undefined);
  assert.ok(!out.donorModulesMd.includes('hollow'));
  const mc = structuredClone(moduleCandidates);
  for (const f of mc.frames) for (const s of f.sections) if (s.node === '1:10') s.hollow = true;
  const o = curate(inputs(rules(), { moduleCandidates: mc }));
  assert.deepEqual(o.donorTokens.coverage.hollow.map((h) => [h.id, h.name, h.frame]), [['M3', 'Footer band', '1:10']]);
  assert.match(o.donorTokens.coverage.hollow[0].why, /childless instances \(likely remote-library components/);
  assert.match(o.donorModulesMd, /\| M3 \| Footer band \|[^\n]*anatomy: single note line on a dark band; hollow: the frame holds only childless instances/);
  assert.equal(o.donorModulesMd.match(/hollow:/g).length, 1);
});
check('module ids: M1 and composition variants such as M1b; anything else is a RulesError', () => {
  const md = curate(inputs(rules((r) => { r.modules[1].id = 'M1b'; r.modules[1].variantOf = 'M1'; return r; }))).donorModulesMd;
  assert.ok(md.includes('| M1b | Feature grid | feature-grid | canon-source'), md);
  for (const bad of ['m1', 'M', 'M1B', 'M1bc', 'M1-b', 'Mb']) rulesError(() => curate(inputs(rules((r) => { r.modules[1].id = bad; return r; }))), /needs an id like M1 \(or M1b/);
  rulesError(() => curate(inputs(rules((r) => { r.modules[1].id = 'M1b'; r.modules[2].id = 'M1b'; return r; }))), /duplicate module id M1b/);
});
check('unknown top-level key or role group → RulesError', () => {
  rulesError(() => curate(inputs(rules((r) => { r.colours = {}; return r; }))), /colours/);
  rulesError(() => curate(inputs(rules((r) => { r.roles['spacing.x'] = { from: 'spacing/pad-80' }; return r; }))), /spacing\.x/);
  rulesError(() => curate(inputs(rules((r) => { r.version = 0; return r; }))), /version/);
});
check('every problem is reported at once', () => {
  try {
    curate(inputs(rules((r) => { r.roles['palette.bodyFg'] = { from: 'colors/x' }; delete r.roles['layout.sectionPaddingY']; return r; })));
    assert.fail('no throw');
  } catch (e) { assert.ok(e.problems.length >= 2, e.message); }
});
check('a curation on a path marked absent is a contradiction', () => {
  rulesError(() => curate(inputs(rules((r) => {
    r.roles['layout.sectionPaddingY'] = { absent: 'pads on inner frames' };
    r.curations = [{ path: 'layout.sectionPaddingY', to: '80px', rule: 'kit spec table', evidence: '2:6' }];
    return r;
  }))), /curations\[0\].*absent/);
});
check('a pipe in a module name, anatomy or why does not break the table', () => {
  const md = curate(inputs(rules((r) => { r.modules[0].name = 'Hero | dark'; r.modules[4].why = 'dup | of M2'; return r; }))).donorModulesMd;
  assert.ok(md.includes('| M1 | Hero \\| dark |'));
  assert.ok(md.includes('excluded — do not develop: dup \\| of M2 |'));
});
check('DESIGN.json refersTo matches the DESIGN.md frontmatter key whatever the component key', () => {
  const o = curate(inputs(rules((r) => { r.roles['buttons.primary'] = { component: 'link-cta', evidence: '2:9' }; return r; })));
  assert.equal(o.designJson.components[0].refersTo, 'button-primary');
  assert.match(o.designJson.components[0].description, /link-cta/);
  assert.ok(o.designMd.includes('  button-primary:\n'));
});

// ---- DESIGN.{md,json} and _brand-extraction.json (shape of the direct-from-phrase fixture) --------
const FX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'evals', 'direct-from-phrase', 'fixture', 'stardust', 'current');
const fxDesign = JSON.parse(readFileSync(join(FX, 'DESIGN.json'), 'utf8'));
const fxBrand = JSON.parse(readFileSync(join(FX, '_brand-extraction.json'), 'utf8'));
const fxMd = readFileSync(join(FX, 'DESIGN.md'), 'utf8');
const { designJson: dj, designMd: dm, brandExtraction: be } = out;

check('DESIGN.json has every top-level and extensions key the fixture has', () => {
  assert.deepEqual(Object.keys(dj), Object.keys(fxDesign));
  assert.deepEqual(Object.keys(dj.extensions), Object.keys(fxDesign.extensions));
  assert.deepEqual(Object.keys(dj.narrative), Object.keys(fxDesign.narrative));
});
check('DESIGN.json: colors with canonical hex, display names, roles; Figma has no breakpoints model', () => {
  assert.deepEqual(dj.extensions.colorMeta['brand-navy'], { role: 'headingFg, darkBandBg', displayName: 'Navy', canonical: '#1f3a5f', tonalRamp: [] });
  assert.equal(dj.extensions.colorMeta['rgb-255-212-0'].role, 'unassigned');
  assert.equal(dj.extensions.breakpoints, null);
  assert.deepEqual(dj.extensions.motion, []);
  assert.equal(dj.extensions.voice, null);
  assert.deepEqual(dj.extensions.typographyMeta, { display: { displayName: 'Inter', purpose: 'page headlines' }, body: { displayName: 'Inter', purpose: 'running copy and leads' } });
  assert.deepEqual(dj.extensions.shadows, [{ name: 'cardResting', value: 'rgba(0, 0, 0, 0.12) 0px 4px 12px 0px', purpose: '' }]);
  assert.equal(dj.extensions.componentStyle.buttons.primary.background, 'rgb(31, 58, 95)');
  assert.equal(dj.extensions.componentStyle.buttons.ghost, null);
  assert.deepEqual(dj.extensions.motifs.borderRadius, { primary: '8px', secondary: '4px', pill: null });
  assert.deepEqual(dj.extensions.motifs.gradients, [{ value: 'GRADIENT_LINEAR', uses: 'Hero (home, node 1:3)' }]);
  assert.equal(dj.title, 'Design System: Sample Kit');
});
check('DESIGN.json components: the mapped buttons with refersTo and css', () => {
  assert.deepEqual(dj.components.map((c) => [c.name, c.kind, c.refersTo]), [['Primary Button', 'button', 'button-primary'], ['Secondary Button', 'button', 'button-secondary']]);
  assert.match(dj.components[0].css, /^background: rgb\(31, 58, 95\); color: rgb\(255, 255, 255\);/);
  assert.equal(dj.components[0].html, null);
  assert.match(dj.components[0].description, /node 1:20/);
});
check('DESIGN.json narrative: authored, rules normalized to { name, body, section }', () => {
  assert.equal(dj.narrative.northStar, 'Quiet confidence: few colors, generous space.');
  assert.deepEqual(dj.narrative.rules, [{ name: 'Rule 1', body: 'one primary button per band', section: 'Overview' }]);
  assert.deepEqual(dj.narrative.dos, ['keep headings in sentence case']);
});
check('_brand-extraction.json top-level keys equal the fixture set; unfilled keys are null or []', () => {
  assert.deepEqual(Object.keys(be), Object.keys(fxBrand));
  for (const k of ['site', 'logo', 'spacing', 'componentStyle', 'iconFont', 'voice', 'voiceTable', 'crossPromo', 'register']) assert.equal(be[k], null, k);
  assert.deepEqual(be.systemComponents, []);
  assert.deepEqual(Object.keys(be.type), Object.keys(fxBrand.type));
  assert.deepEqual(Object.keys(be.motifs), Object.keys(fxBrand.motifs));
});
check('_brand-extraction.json: palette, type and motifs from the capture', () => {
  const navy = be.palette.find((p) => p.value === '#1f3a5f');
  assert.deepEqual(Object.keys(navy), Object.keys(fxBrand.palette[0]));
  assert.deepEqual(navy.usedAs, ['background', 'text', 'border']);
  assert.equal(navy.role, 'headingFg, darkBandBg');
  assert.deepEqual(be.type.headingFamily, { name: 'Inter Display', stack: 'Inter', weights: [700], sizes: ['56px', '40px'], lineHeights: [1.143, 1.2], letterSpacing: ['-1.12px', '-0.8px'], sourceSelectors: [] });
  assert.equal(be.type.bodyFamily.name, 'Inter');
  assert.deepEqual([be.type.files, be.type.loadStrategy, be.type.monoFamily], [[], null, null]);
  assert.deepEqual(be.motifs.patterns.map((p) => p.name), ['Gradient hero', 'Feature grid', 'Footer band', 'Article body']);
  assert.match(be.motifs.patterns[0].evidence, /home\.png · node 1:3/);
});
check('schemaVersion 2 and provenance first in both files; descriptive, not browser-rendered', () => {
  assert.equal(Object.keys(dj)[0], '_provenance');
  assert.equal(dj.schemaVersion, 2);
  assert.equal(dj.generatedAt, '2026-01-02T03:04:05Z');
  assert.match(dj._provenance.note, /not browser-rendered/);
  assert.equal(Object.keys(be)[0], '_provenance');
  assert.ok(dm.startsWith('<!-- stardust:provenance\n'));
  assert.match(dm.split('-->')[0], /DESCRIPTIVE capture of a Figma design system \(REST\), not browser-rendered/);
});
check('DESIGN.md has the six fixture section headings in order, after YAML frontmatter', () => {
  const heads = (md) => md.split('\n').filter((l) => /^## \d\. /.test(l));
  assert.deepEqual(heads(dm), heads(fxMd));
  const fm = dm.split('-->\n')[1];
  assert.ok(fm.startsWith('---\nname: "Sample Kit"\n'), fm.slice(0, 80));
  for (const key of ['description:', 'colors:', 'typography:', 'rounded:', 'spacing:', 'components:']) assert.ok(fm.split('\n---\n')[0].includes(`\n${key}`), key);
  assert.ok(dm.includes('  brand-navy: "#1f3a5f"'));
  assert.ok(dm.includes('    backgroundColor: "{colors.brand-navy}"'));
  assert.ok(dm.includes('# Design System: Sample Kit'));
  assert.ok(dm.includes('**Creative North Star: "Quiet confidence: few colors, generous space."**'));
});
check('origins[0].role is design-source', () => {
  assert.deepEqual(be.origins, [{ origin: donorUrl, role: 'design-source', pagesCaptured: 2, contributedSignals: ['palette', 'type', 'motifs'] }]);
});
check('still byte-identical across two runs', () => assert.equal(JSON.stringify(curate(inputs())), JSON.stringify(out)));
check('no design block: placeholders, never invented prose', () => {
  const o = curate(inputs(rules((r) => { delete r.design; return r; })));
  assert.deepEqual(o.designJson.narrative, { northStar: '', overview: '', keyCharacteristics: [], rules: [], dos: [], donts: [] });
  assert.match(o.designMd, /_\(not authored: add design\.narrative to curation-rules\.json\)_/);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
