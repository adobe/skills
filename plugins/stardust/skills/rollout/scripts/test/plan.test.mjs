#!/usr/bin/env node
// Fixture test: rollout/scripts/plan.mjs — layout clusters as plan input (T28.1).
//
//   no clusters   without stardust/current/layout-clusters.json the plan has no `clusters` key, no coverage line
//   gap           an ungated cluster ≥ T → its pages' steps carry coverageGap "ungated cluster <id> (<n> pages)" +
//                 exemplar, the plan prints `coverage gap: ungated cluster <id> (<n> pages) … $stardust replica <exemplar>`
//                 and `clusters gated C of K · ungated: <id (n)>` (NEGATIVE: nothing printed either line before);
//                 a gated cluster and a coveredBy cluster count as gated; pages outside a gap carry no flag
//   read-only     plan.mjs never writes layout-clusters.json / state.json; --help exit 0
//
// Usage: node plugins/stardust/skills/rollout/scripts/test/plan.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SHARED = join(HERE, '..', '..', '..', '..', 'evals', '_shared', 'fixture-post-migrate', 'stardust', 'migrated');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const T = mkdtempSync(join(tmpdir(), 'plan-test-'));
mkdirSync(join(T, 'stardust', 'current'), { recursive: true });
cpSync(SHARED, join(T, 'stardust', 'migrated'), { recursive: true });
const node = (script, args) => spawnSync(process.execPath, [join(HERE, '..', script), ...args], { cwd: T, encoding: 'utf8' });
assert.equal(node('inventory.mjs', ['--migrated', 'stardust/migrated', '--out', 'stardust/rollout']).status, 0);
assert.equal(node('blocks.mjs', ['--out', 'stardust/rollout']).status, 0);

// no clusters file → no clusters key, no coverage line
let r = node('plan.mjs', ['--out', 'stardust/rollout']);
assert.equal(r.status, 0, r.stderr);
assert.equal(json(join(T, 'stardust', 'rollout', 'plan.json')).clusters, undefined);
assert.doesNotMatch(r.stdout, /clusters gated|coverage gap/);

// an ungated cluster over two pages, a gated one, a covered one
const slugs = json(join(T, 'stardust', 'rollout', 'coverage', 'pages.json')).pages.map((p) => p.slug).sort();
assert.ok(slugs.length >= 4, `fixture pages: ${slugs}`);
const [a, b, c, d] = slugs;
const clusters = { generatedAt: '2026-09-20T00:00:00Z', minCluster: 2, k: 1, breakpoints: [1440, 360], types: [{ type: 'landing', pages: 4, clusters: [
  { id: 'c1', signature: ['hero'], count: 1, pages: [a], exemplar: a, gated: { 1440: 'pass', 360: 'accepted' } },
  { id: 'c2', signature: ['hero', 'grid'], count: 2, pages: [b, c], exemplar: b, gated: { 1440: 'ungated', 360: 'ungated' } },
  { id: 'c3', signature: ['hero', 'grid', 'faq'], count: 1, pages: [d], exemplar: d, gated: { 1440: 'fail', 360: 'ungated' }, coveredBy: { cluster: 'c1', reason: 'variant', by: 'operator' } },
], tail: [], unclustered: [] }] };
writeFileSync(join(T, 'stardust', 'current', 'layout-clusters.json'), JSON.stringify(clusters));
const before = readFileSync(join(T, 'stardust', 'current', 'layout-clusters.json'), 'utf8');
r = node('plan.mjs', ['--out', 'stardust/rollout']);
assert.equal(r.status, 0, r.stderr);
const plan = json(join(T, 'stardust', 'rollout', 'plan.json'));
assert.deepEqual(plan.clusters, { total: 3, gated: 2, ungated: [{ id: 'c2', type: 'landing', count: 2, exemplar: b }] }, 'gated + coveredBy count as gated; c2 is the gap');
const step = (s) => plan.steps.find((x) => x.slug === s);
assert.equal(step(b).coverageGap, 'ungated cluster c2 (2 pages)'); assert.equal(step(c).coverageGap, 'ungated cluster c2 (2 pages)'); assert.equal(step(c).exemplar, b); assert.equal(step(c).layoutCluster, 'c2');
assert.equal(step(a).coverageGap, undefined, 'a gated cluster page carries no flag'); assert.equal(step(d).coverageGap, undefined, 'a coveredBy cluster page carries no flag');
assert.match(r.stdout, /coverage gap: ungated cluster c2 \(2 pages\) — landing: render nothing in it; gate the exemplar first: \$stardust replica /);
assert.match(r.stdout, /^clusters gated 2 of 3 · ungated: c2 \(2\)$/m, 'the coverage line (rollout SKILL Setup 2)');
assert.match(r.stdout, new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\S+\\s+.*⛔ coverage gap: ungated cluster c2`));
assert.equal(readFileSync(join(T, 'stardust', 'current', 'layout-clusters.json'), 'utf8'), before, 'plan.mjs never writes the cluster file');
assert.equal(node('plan.mjs', ['--help']).status, 0);
rmSync(T, { recursive: true, force: true });
console.log('plan.test: ok (no clusters → no line; ungated cluster → coverage gap steps + coverage line; gated/covered count as gated; read-only)');
