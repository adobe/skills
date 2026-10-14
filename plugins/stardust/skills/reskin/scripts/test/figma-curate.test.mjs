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
import { buildFoundation, PROBE_PATHS } from '../figma/foundation.mjs';
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
  assert.deepEqual(Object.keys(t), ['_provenance', 'donor', 'curatedFrom', 'note', 'palette', 'type', 'layout', 'buttons', 'radii', 'shadows', 'motifs', 'nodeRefs', 'coverage']);
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
  assert.ok(md.includes('| # | Module | Where seen | Description |\n|---|--------|-----------|-------------|'));
  assert.ok(md.includes('| M1 | Gradient hero | canon-source/assets/screenshots/home.png · node 1:3 | anatomy: display headline + lede + primary and secondary CTA; components: Button |'));
  assert.ok(md.includes('| M2 | Feature grid | canon-source/assets/screenshots/home.png · node 1:7 | anatomy: section title + feature copy + card (label, CTA); variants: Show heading; components: Feature Grid, Button |'));
  assert.ok(md.includes('| — | Related | canon-source/assets/screenshots/article.png · node 2:8 | excluded — do not develop: a second instance of the feature grid; M2 covers it |'));
  for (const row of lines.filter((l) => /^\| (M\d+|—) \|/.test(l))) assert.match(row, /screenshots\/[a-z0-9-]+\.png · node I?\d+:\d+/);
  assert.equal(lines.at(-1), '**Notes for reskin:** sentence-case headings; navy and off-white bands alternate; buttons are 8px rounded with semibold labels');
});
check('a module without a screenshot or with a bad frame → RulesError (evidence-bound)', () => {
  rulesError(() => curate(inputs(rules(), { screenshotIndex: { ...screenshotIndex, article: { ...screenshotIndex.article, renderable: false } } })), /M4.*screenshot/);
  rulesError(() => curate(inputs(rules((r) => { r.modules[0].frame = '9:9'; return r; }))), /M1.*9:9/);
  rulesError(() => curate(inputs(rules((r) => { r.modules[1].id = 'M1'; return r; }))), /duplicate.*M1/);
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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
