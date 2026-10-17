#!/usr/bin/env node
// skills/rollout/scripts/test/block-origin.test.mjs — the delivered walker block-origin.mjs builds on
// (lib.mjs walkDelivered: parseDelivered's records with their nodes, parseDelivered unchanged).
// Run: node plugins/stardust/skills/rollout/scripts/test/block-origin.test.mjs
import assert from 'node:assert/strict';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e && e.message).split('\n').join('\n  ')}`); } };
// Imported as a namespace so a missing export fails its own checks, not the whole file.
const lib = await import('../lib.mjs').catch((e) => { console.log(`(../lib.mjs did not load: ${e.message})`); return {}; });

// A hub page as delivered: a styled section (default content, a teaser grid, default content, chrome-free),
// a metadata-only section (no record), a section with a hero, a chrome div and a separator.
const DELIVERED = `<html><head><title>A hub page</title></head><body><header></header><main>
<div>
  <h1>A hub page</h1>
  <p>Intro text for the hub.</p>
  <div class="teaser grid"><div><div><p>First teaser</p></div><div>Second teaser</div></div><div><div>Third teaser</div></div></div>
  <p><a href="/more">More</a></p>
  <ul><li><a href="/a">A link</a></li></ul>
  <div class="section-metadata"><div><div>style</div><div>dark</div></div></div>
</div>
<div><div class="metadata"><div><div>title</div><div>Hub</div></div></div></div>
<div>
  <div class="hero"><div><div><h2>Welcome</h2></div></div></div>
  <div class="nav"><div><div>chrome</div></div></div>
  <hr>
</div>
</main><footer></footer></body></html>`;

check('walkDelivered: { records, sections, metadata, nodes }; nodes line up with records', () => {
  const w = lib.walkDelivered(DELIVERED);
  assert.deepEqual(Object.keys(w), ['records', 'sections', 'metadata', 'nodes']);
  assert.deepEqual(w.records.map((r) => [r.pos, r.kind, r.block, r.variant]), [
    [0, 'default', 'default-content', 'heading+text'],
    [1, 'block', 'teaser', 'grid'],
    [2, 'default', 'default-content', 'button+link-list'],
    [3, 'block', 'hero', null],
    [4, 'default', 'default-content', 'separator'],
  ]);
  assert.equal(w.nodes.length, w.records.length);
  for (const r of w.records) {
    const n = w.nodes[r.pos];
    if (r.kind === 'block') {
      assert.ok(!Array.isArray(n), `record ${r.pos}: a block's node is its div`);
      assert.equal(n.tag, 'div');
      assert.equal(lib.classList(n)[0], r.block);
    } else {
      assert.ok(Array.isArray(n), `record ${r.pos}: a default record's nodes are an array`);
    }
  }
  assert.deepEqual(w.nodes[0].map((n) => [n.tag, lib.textOf(n)]), [['h1', 'A hub page'], ['p', 'Intro text for the hub.']]);
  assert.deepEqual(w.nodes[2].map((n) => [n.tag, lib.textOf(n)]), [['p', 'More'], ['ul', 'A link']]);
  assert.deepEqual(w.nodes[4].map((n) => n.tag), ['hr']);
  assert.deepEqual(lib.classList(w.nodes[1]), ['teaser', 'grid']);
  assert.equal(lib.elements(w.nodes[1]).length, 2, 'the teaser grid div keeps its two rows');
  assert.match(lib.textOf(w.nodes[3]), /Welcome/);
});

check('parseDelivered: exactly { records, sections, metadata } of walkDelivered', () => {
  const p = lib.parseDelivered(DELIVERED);
  const w = lib.walkDelivered(DELIVERED);
  assert.deepEqual(Object.keys(p), ['records', 'sections', 'metadata']);
  assert.deepEqual(p, { records: w.records, sections: w.sections, metadata: w.metadata });
  assert.deepEqual(p.sections, [{ pos: 0, style: 'dark', blocks: [0, 1, 2] }, { pos: 1, style: null, blocks: [3, 4] }]);
  assert.deepEqual(p.metadata, { title: 'Hub' });
});

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
