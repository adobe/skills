#!/usr/bin/env node
// skills/rollout/scripts/test/plan.test.mjs — plan.mjs's C14 marks: every step carries needsHarness + harnessWhy.
// A synthetic project: one encoded template (archetype + encoded siblings: one covered by the archetype's passedOn, two
// with the same new shape, one clone without an encode) and one template without a map. Checks: the covered sibling
// inherits the launches, the first page with a new shape runs them and the next one waits for it, a clone and a page of
// an unmapped template run them; a block edit moves the harness key and re-arms the archetype; the plan's dedup
// output is unchanged. migrate's encode/shape.mjs and encode/provenance.mjs build the encoded pages.
// Run: node plugins/stardust/skills/rollout/scripts/test/plan.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoderKey, mapKey, sha256 } from '../../../migrate/scripts/encode/provenance.mjs';
import { harnessKey, shapeOf } from '../../../migrate/scripts/encode/shape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'plan.mjs');
const T = mkdtempSync(join(tmpdir(), 'rollout-plan-test-'));
const put = (rel, data) => { mkdirSync(dirname(join(T, rel)), { recursive: true }); writeFileSync(join(T, rel), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`); };
const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: T, encoding: 'utf8' });
const steps = () => Object.fromEntries(JSON.parse(readFileSync(join(T, 'stardust/rollout/plan.json'), 'utf8')).steps.map((s) => [s.slug, `${s.needsHarness ? 'RUN' : 'skip'}: ${s.harnessWhy}`]));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const A = 'trip-a';
const cards = (n) => `<div class="cards">${'<div><div><img src="/x.jpg" alt=""></div><div><p>Card</p></div></div>'.repeat(n)}</div>`;
const html = (n) => `<body><header></header><main><div><div class="metadata"><div><div>Title</div><div>T</div></div></div></div><div><h1>T</h1>${cards(n)}</div></main><footer></footer></body>\n`;
put(`stardust/import/${A}/vocabulary.json`, { root: 'main', markers: [{ sel: '.mod-cards', kind: 'cards', emitter: 'block:cards', rows: '.card', cells: [{ sel: 'img', as: 'image' }, { sel: 'p', as: 'rich' }] }] });
put('blocks/cards/cards.js', 'export default function decorate() {}\n');
const keys = { encoder: encoderKey(), map: mapKey(T, A) };
const manifest = {};
const rows = [];
const encoded = (slug, n, extra = {}) => {
  const doc = `stardust/encoded/trips/${slug}.html`; const side = `stardust/migrated/trips/${slug}._meta.json`;
  put(doc, html(n));
  manifest[doc] = sha256(html(n));
  put(side, { slug, renderBranch: slug === A ? 'A' : "A'", fidelityTier: slug === A ? 'archetype' : 'sibling', template: slug === A ? null : A, modules: [], ...extra,
    encode: { encoder: keys.encoder, map: keys.map, inputs: {}, output: { path: doc, sha: sha256(html(n)) }, encodedAt: '2026-10-01T00:00:00Z' },
    audit: { encode: { status: 'clean', shape: shapeOf(html(n)) } } });
  rows.push({ slug, path: `/trips/${slug}`, templateId: 'trip', source: { migratedHtml: null, metaJson: side }, blocks: [], delivery: { status: 'pending' } });
};
encoded(A, 2); encoded('trip-b', 2); encoded('trip-c', 4); encoded('trip-d', 4);
put('stardust/migrated/trips/trip-e._meta.json', { slug: 'trip-e', renderBranch: "A'", template: A, modules: [], encode: null, audit: null });
rows.push({ slug: 'trip-e', path: '/trips/trip-e', templateId: 'trip', source: { migratedHtml: 'stardust/migrated/trips/trip-e.html', metaJson: 'stardust/migrated/trips/trip-e._meta.json' }, blocks: [], delivery: { status: 'pending' } });
rows.push({ slug: 'about', path: '/about', templateId: 'about', source: { migratedHtml: 'stardust/migrated/about.html', metaJson: null }, blocks: [], delivery: { status: 'pending' } });
put(`stardust/import/${A}/manifest.json`, manifest);
put('stardust/rollout/coverage/pages.json', { pages: rows });
put('stardust/rollout/coverage/blocks.json', { blocks: [] });
put('stardust/rollout/coverage/templates.json', { templates: [
  { id: 'trip', representativeSlug: A, pages: [A, 'trip-b', 'trip-c', 'trip-d', 'trip-e'], pageCount: 5 },
  { id: 'about', representativeSlug: 'about', pages: ['about'], pageCount: 1 },
] });
const archSide = `stardust/migrated/trips/${A}._meta.json`;
const k0 = (await harnessKey(T, A)).key;
put(archSide, { ...JSON.parse(readFileSync(join(T, archSide), 'utf8')), passedOn: { key: k0, shapes: [{ slug: A, shape: shapeOf(html(2)) }] } });

try {
  check('needsHarness per step: covered siblings inherit, a new shape runs once, clones and unmapped templates run', () => {
    const r = run(); assert.equal(r.status, 0, r.stderr);
    const short = `${k0.slice(0, 19)}…`;
    assert.deepEqual(steps(), {
      [A]: `skip: covered by passedOn under ${short} (${A})`,
      'trip-b': `skip: covered by passedOn under ${short} (${A})`,
      'trip-c': 'RUN: new shape: "cards" has 4 rows (exercised 2)',
      'trip-d': 'skip: covered once trip-c pass the launches',
      'trip-e': 'RUN: not an encoded page: it runs the launches',
      about: 'RUN: template about is not encoded (no stardust/import/about/vocabulary.json): it runs the launches',
    });
    assert.match(r.stdout, /^Local harness launches \(C14\): 3 page\(s\) run them; 3 inherit them/m);
    assert.deepEqual(JSON.parse(readFileSync(join(T, 'stardust/rollout/plan.json'), 'utf8')).deliveryOrder, [A, 'trip-b', 'trip-c', 'trip-d', 'trip-e', 'about'], 'the delivery order is unchanged');
  });
  check('a block edit moves the harness key: the archetype and the representative re-run, the rest wait for them', () => {
    put('blocks/cards/cards.css', '.cards { display: grid; }\n');
    const r = run(); assert.equal(r.status, 0, r.stderr);
    const s = steps();
    assert.match(s[A], /^RUN: the harness key moved since the recorded pass/);
    assert.equal(s['trip-b'], `skip: covered once ${A} pass the launches`);
    assert.match(s['trip-c'], /^RUN: new shape: "cards" has 4 rows \(exercised 2\) \(the harness key moved/);
    assert.equal(s['trip-d'], `skip: covered once ${A}, trip-c pass the launches`);
  });
} finally {
  rmSync(T, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
