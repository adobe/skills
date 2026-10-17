#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-checks.test.mjs — figma-gate/checks.mjs over the synthetic kit
// (fixtures/figma-kit/nodes.json, fixtures/figma-gate/checks.json): defaults, every problem of an invalid
// checks file collected at once, token sources, per-width roots, skip, pixel modes and rootsNamed.
// Pure, no network. Run: node <this file>.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { MEASURES, leavesSection, rootsNamed, scopeSelector, selectorBranches, validateChecks } from '../figma-gate/checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const nodes = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'nodes.json'), 'utf8'));
const fixtureChecks = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-gate', 'checks.json'), 'utf8'));
const boxes = buildBoxes({ nodes, roots: ['1:3', '1:7'] });
const join2 = { sections: [{ slot: 's01', module: 'M1', node: '1:3' }, { slot: 's02', module: 'M2', node: '1:7' }] };
const ctx = { join: join2, boxes, tokens: {} };
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const skipped = { skip: 'not under test', geometry: [], type: [] };
const problemsOf = (sections, extra = ctx) => validateChecks({ version: 1, page: 'home', sections: { s01: skipped, ...sections } }, extra).problems.join('\n');
const geo = (entry) => ({ s02: { geometry: [{ id: 'x', selector: '.card', ...entry }], type: [{ id: 't', selector: 'h2', node: 'I1:7;5:2' }] } });

check('the fixture is valid and gets its defaults', () => {
  const ok = validateChecks(fixtureChecks, ctx);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.sections.s02.root, '1:7');
  assert.equal(ok.sections.s02.width, 1440);
  assert.deepEqual(ok.sections.s02.roots, { 1440: '1:7' });
  assert.equal(ok.sections.s02.geometry[0].tolerancePx, 1);
  assert.equal(ok.sections.s02.geometry[0].index, 0);
  assert.equal(ok.sections.s02.pixel.mode, 'auto');
  assert.equal(ok.sections.s01.geometry.length, 6);
});

check('an invalid file lists every problem at once', () => {
  const bad = validateChecks({ version: 1, page: 'home', sections: {
    s09: { geometry: [], type: [] },
    s02: { geometry: [
      { id: 'a', selector: '.card', node: 'I2:8;5:3', measure: 'width' },
      { id: 'b', selector: '.lead', node: 'I1:7;5:3', measure: 'height' },
      { id: 'c', selector: '.feature', nodes: ['I1:7;5:3'], measure: 'gapX' },
      { id: 'd', selector: 'h2', node: 'I1:7;5:2', measure: 'paddingTop' },
      { id: 'e', selector: ':scope', token: 'layout.nope', measure: 'paddingLeft', width: 360 },
      { id: 'f', selector: '.card', node: 'I1:7;5:7', measure: 'width', width: 360 } ], type: [] },
    s01: {} } }, ctx).problems.join('\n');
  assert.match(bad, /s09 is not a joined section/);
  assert.match(bad, /a: I2:8;5:3 is not inside s02's root 1:7/);
  assert.match(bad, /b: height is content-dependent: needs tolerancePx and why/);
  assert.match(bad, /c: gapX needs nodes: \[a, b\]/);
  assert.match(bad, /d: I1:7;5:2 has no auto-layout padding/);
  assert.match(bad, /e: token layout.nope is not a px value in donor-tokens.json/);
  assert.match(bad, /f: width 360 needs sections.s02.roots\["360"\] or a token/);
  assert.match(bad, /s02 has no type checks/);
  assert.match(bad, /s01 has no geometry checks: add one or "skip": "<why>"/);
  assert.doesNotMatch(bad, /e: width 360 needs/);
});

check('measures: the list, unknown measure, tolerance rules', () => {
  assert.deepEqual(MEASURES, ['width', 'left', 'right', 'top', 'height', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'bottom' })), /x: unknown measure bottom/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'top' })), /x: top is content-dependent: needs tolerancePx and why/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'top', tolerancePx: 8 })), /x: top is content-dependent/);
  assert.equal(problemsOf(geo({ node: 'I1:7;5:7', measure: 'height', tolerancePx: 8, why: 'wraps with the copy' })), '');
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'width', tolerancePx: 3 })), /x: tolerancePx 3 above 1 needs why/);
  assert.equal(problemsOf(geo({ node: 'I1:7;5:7', measure: 'width', tolerancePx: 3, why: 'fluid column' })), '');
  assert.match(problemsOf(geo({ nodes: ['I1:7;5:3', 'I1:7;5:4', 'I1:7;5:7'], measure: 'gapY' })), /x: gapY needs nodes: \[a, b\]/);
  assert.match(problemsOf(geo({ node: 'I1:7;5:7', measure: 'gapX' })), /x: gapX needs nodes: \[a, b\]/);
  assert.match(problemsOf(geo({ measure: 'width' })), /x: needs one of node, nodes or token/);
});

check('tokens: a px value is accepted, anything else is a problem', () => {
  const t = (tokens, token = 'layout.pad') => problemsOf(geo({ token, measure: 'paddingLeft' }), { ...ctx, tokens });
  assert.equal(t({ layout: { pad: '24px' } }), '');
  assert.equal(t({ layout: { pad: '-1.5px' } }), '');
  assert.match(t({ layout: { pad: '2rem' } }), /x: token layout.pad is not a px value in donor-tokens.json/);
  assert.match(t({ layout: { pad: { a: '1px' } } }), /x: token layout.pad is not a px value/);
  assert.match(t({}), /x: token layout.pad is not a px value/);
});

check('per-width roots: a root is found, a node must sit under it', () => {
  const roots = { 360: '1:3' };
  const ok = validateChecks({ version: 1, page: 'home', sections: { s02: { roots, geometry: [{ id: 'x', selector: '.card', node: '1:5', measure: 'width', width: 360 }], type: [{ id: 't', selector: 'h2', node: 'I1:7;5:2' }] }, s01: { skip: 'covered by s02', geometry: [], type: [] } } }, ctx);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.sections.s02.roots, { 360: '1:3', 1440: '1:7' });
  assert.equal(ok.sections.s02.geometry[0].width, 360);
  const bad = validateChecks({ version: 1, page: 'home', sections: { s02: { roots, geometry: [{ id: 'x', selector: '.card', node: 'I1:7;5:7', measure: 'width', width: 360 }], type: [{ id: 't', selector: 'h2', node: 'I1:7;5:2' }] }, s01: { skip: 'x', geometry: [], type: [] } } }, ctx).problems.join('\n');
  assert.match(bad, /x: I1:7;5:7 is not inside s02's root 1:3/);
});

check('type entries: the node must be TEXT and inside the root', () => {
  const t = (type) => problemsOf({ s02: { geometry: [{ id: 'g', selector: '.card', node: 'I1:7;5:7', measure: 'width' }], type } });
  assert.match(t([{ id: 't', selector: '.card', node: 'I1:7;5:7' }]), /t: I1:7;5:7 is not TEXT/);
  assert.match(t([{ id: 't', selector: 'h2', node: '1:5' }]), /t: 1:5 is not inside s02's root 1:7/);
});

check('skip with a why replaces the checks; a joined section without a module needs none', () => {
  assert.equal(problemsOf({ s01: { skip: 'static banner', geometry: [], type: [] }, s02: geo({ node: 'I1:7;5:7', measure: 'width' }).s02 }), '');
  assert.match(problemsOf({ s01: { skip: '', geometry: [], type: [] }, s02: geo({ node: 'I1:7;5:7', measure: 'width' }).s02 }), /s01 has no geometry checks/);
  const noModule = { join: { sections: [{ slot: 's05', module: null, node: null }] }, boxes, tokens: {} };
  assert.deepEqual(validateChecks({ version: 1, page: 'home', sections: {} }, noModule).problems, []);
});

check('pixel modes', () => {
  const p = (pixel) => problemsOf({ s01: { skip: 'x', geometry: [], type: [], pixel }, s02: { skip: 'x', geometry: [], type: [] } });
  assert.equal(p({ mode: 'off', why: 'animated' }), '');
  assert.equal(p({ mode: 'fixture', fixtureUrl: 'http://127.0.0.1:1/f.html' }), '');
  assert.match(p({ mode: 'fixture' }), /s01: pixel fixture needs fixtureUrl/);
  assert.match(p({ mode: 'off' }), /s01: pixel off needs why/);
  assert.match(p({ mode: 'blur' }), /s01: pixel mode blur is not auto, fixture or off/);
});

check('structure: version, page, ids, root nodes missing from the boxes', () => {
  assert.match(validateChecks({ version: 2, page: 'home', sections: {} }, ctx).problems.join('\n'), /version must be 1/);
  assert.match(validateChecks({ version: 1, sections: {} }, ctx).problems.join('\n'), /page must be a slug/);
  const dup = problemsOf({ s02: { geometry: [{ id: 'a', selector: '.card', node: 'I1:7;5:7', measure: 'width' }, { id: 'a', selector: '.card', node: 'I1:7;5:7', measure: 'left' }], type: [{ id: 't', selector: 'h2', node: 'I1:7;5:2' }] }, s01: { skip: 'x', geometry: [], type: [] } });
  assert.match(dup, /s02: duplicate id a/);
  const lost = validateChecks({ version: 1, page: 'home', sections: {} }, { ...ctx, boxes: { roots: {} } }).problems.join('\n');
  assert.match(lost, /s01: root 1:3 is not in the loaded boxes/);
});

check('rootsNamed: the roots a checks file needs loaded', () => {
  assert.deepEqual(rootsNamed(fixtureChecks, join2), ['1:3', '1:7']);
  const named = { version: 1, page: 'home', sections: { s02: { node: '1:9', roots: { 360: '1:8' }, geometry: [], type: [] } } };
  assert.deepEqual(rootsNamed(named, join2), ['1:3', '1:9', '1:8']);
  assert.deepEqual(rootsNamed({}, { sections: [] }), []);
});

const S = 'main section[data-slot="s02"]';
const P = 'main > div:nth-child(3)';

check('scopeSelector: a plain selector is a descendant of the section, :scope is the section, and a :scope branch keeps its combinator', () => {
  assert.equal(scopeSelector(S, '.card'), `${S} .card`);
  assert.equal(scopeSelector(S, 'h2 + p'), `${S} h2 + p`);
  assert.equal(scopeSelector(S, ':scope'), S);
  assert.equal(scopeSelector(S, ':scope > div'), `${S} > div`);
  assert.equal(scopeSelector(S, ':scope > .x .y'), `${S} > .x .y`);
  assert.equal(scopeSelector(S, ':scope  .y'), `${S}  .y`);
  assert.equal(scopeSelector(S, ':scope.open'), `${S}.open`);
  assert.equal(scopeSelector(S, ':SCOPE > p'), `${S} > p`);
  assert.equal(scopeSelector(P, ':scope > div'), `${P} > div`);
  assert.equal(scopeSelector(S, '> p'), `${S} > p`);
  assert.equal(scopeSelector(S, ':scoped-thing'), `${S} :scoped-thing`, ':scope is a whole pseudo-class name');
});

check('scopeSelector: every top-level branch of a comma list is scoped; a comma inside :is(), :where(), :not(), an attribute value or a string stays', () => {
  assert.equal(scopeSelector(S, '.a, .b'), `${S} .a, ${S} .b`);
  assert.equal(scopeSelector(S, ':scope > .a,\n .b .c , :scope'), `${S} > .a, ${S} .b .c, ${S}`);
  assert.equal(scopeSelector(S, ':is(.a, .b) > p'), `${S} :is(.a, .b) > p`);
  assert.equal(scopeSelector(S, '.x:where(.a, .b), .y:not(.c, .d)'), `${S} .x:where(.a, .b), ${S} .y:not(.c, .d)`);
  assert.equal(scopeSelector(S, 'a[title="x, y"], a[title=\'p,q\']'), `${S} a[title="x, y"], ${S} a[title='p,q']`);
  assert.equal(scopeSelector(S, 'a[title="a\\"b, c"], i'), `${S} a[title="a\\"b, c"], ${S} i`);
  assert.equal(scopeSelector(S, '.a\\,b, .c'), `${S} .a\\,b, ${S} .c`);
  assert.equal(scopeSelector(S, ':is(.a, :is(.b, .c)), .d'), `${S} :is(.a, :is(.b, .c)), ${S} .d`);
});

check('scopeSelector: a stray comma stays an invalid selector instead of becoming the section', () => {
  assert.equal(scopeSelector(S, '.a,'), `${S} .a, `);
  assert.equal(scopeSelector(S, ', .a'), `, ${S} .a`);
  assert.deepEqual(selectorBranches('a, b'), ['a', ' b']);
  assert.deepEqual(selectorBranches(':is(a, b'), [':is(a, b'], 'an unbalanced (…) is one branch, and the browser rejects it');
});

check('leavesSection: a branch whose first combinator, after any :scope and its compound, is a sibling one reaches outside the section', () => {
  for (const ok of ['.a, :scope', ':scope', ':scope > .a', ':scope .a ~ .b', '> p', '.a + .b', ':is(.a, .b) ~ p', ':scope > .a, .b ~ .c', ':scoped + p', ':scope[title="a +b"] > p']) assert.equal(leavesSection(ok), null, ok);
  for (const bad of [':scope + p', ':scope~p', ':scope.x ~ p', ':scope:not(.x, .y) + p', '+ p', '.a, ~ p', ':scope > .a, :scope + p']) assert.match(leavesSection(bad), /reaches the section's siblings/, bad);
  assert.match(leavesSection('.a, ~ p'), /^selector "~ p" reaches/);
});

check('a selector or previewSelector that reaches the section\'s siblings is a problem, naming the entry', () => {
  assert.equal(problemsOf(geo({ selector: ':scope > .card', node: 'I1:7;5:7', measure: 'width' })), '');
  assert.equal(problemsOf(geo({ selector: '.card, :scope', node: 'I1:7;5:7', measure: 'width' })), '');
  assert.match(problemsOf(geo({ selector: ':scope + .card', node: 'I1:7;5:7', measure: 'width' })), /^x: selector ":scope \+ \.card" reaches the section's siblings/);
  assert.match(problemsOf(geo({ selector: '.card', previewSelector: '.a, ~ .b', node: 'I1:7;5:7', measure: 'width' })), /^x: previewSelector: selector "~ \.b" reaches the section's siblings/);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
