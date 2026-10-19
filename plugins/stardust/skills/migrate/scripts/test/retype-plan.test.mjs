// Contract test for migrate.mjs retype-plan — groups a differing-sibling variance ledger into
// proposed sub-archetypes, records the re-type deviation WITHOUT a rendered _meta.json sidecar.
// Fixtures follow the sibling-variance.mjs ledger shape ({ template, archetype, at, siblings:
// [{ slug, url, verdict, missing[], extra[], deltas[{ kind, probe?, msg }] }] }) with generic slugs
// and probe names. Pure grouping is checked through the exported retypeFingerprint / retypePlan;
// files, exit codes and idempotency through the CLI. No browser.
// Run: node skills/migrate/scripts/test/retype-plan.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retypeFingerprint, retypePlan } from '../migrate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrate.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'retype-plan-test-'));
let failed = 0; let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`); }
}
const run = (args, cwd = tmp) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const ledger = (slug, siblings) => { const f = join(tmp, 'stardust/rollout/variance', `${slug}.json`); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, `${JSON.stringify({ template: slug, archetype: `https://example.test/${slug}/`, at: '2026-10-01T00:00:00Z', siblings }, null, 2)}\n`); };
const planFile = (slug) => join(tmp, 'stardust/migrate/retype-plan', `${slug}.json`);
const readPlan = (slug) => JSON.parse(readFileSync(planFile(slug), 'utf8'));

// A differing row with a missing set and a cluster/count shape; the PROBE message carries moving
// pixel noise the fingerprint must ignore.
const diff = (slug, missing, shapeProbes, extra = []) => ({
  slug, url: `https://example.test/${slug}/`, verdict: 'differs', missing, extra,
  deltas: [
    ...shapeProbes.map((p) => ({ kind: 'COUNT', probe: p, msg: `8 → ${slug.length} matches` })),
    ...shapeProbes.map((p) => ({ kind: 'CLUSTERS', probe: p, msg: `8 → ${slug.length} distinct style families among matches` })),
    ...shapeProbes.map((p) => ({ kind: 'PROBE', probe: p, msg: `rect{w 970 → ${slug.length * 7}}` })),
  ],
});
const same = (slug) => ({ slug, url: `https://example.test/${slug}/`, verdict: 'same', missing: [], extra: [], deltas: [] });

// ---- pure: the delta fingerprint -----------------------------------------------------------------
console.log('fingerprint');
check('fingerprint = sorted missing[] + the COUNT/CLUSTERS probe set; magnitudes and PROBE deltas ignored', () => {
  const a = diff('x', ['button', 'band'], ['hero', 'card']);
  const b = diff('yy', ['band', 'button'], ['card', 'hero']); // same missing + shape, different magnitudes/order
  assert.equal(retypeFingerprint(a), 'missing=[band,button]; shape=[card,hero]');
  assert.equal(retypeFingerprint(a), retypeFingerprint(b), 'order and magnitude are not part of the fingerprint');
  assert.equal(retypeFingerprint(diff('z', [], ['hero'])), 'missing=[]; shape=[hero]');
  assert.equal(retypeFingerprint({ missing: ['a'], deltas: [{ kind: 'PROBE', probe: 'hero', msg: 'm' }, { kind: 'SECTIONS', msg: 'm' }] }), 'missing=[a]; shape=[]', 'PROBE and SECTIONS carry no shape');
});

// ---- (a) 3 + 2 → two groups with the right members and representatives ----------------------------
console.log('(a) 5 siblings, 3 + 2 missing-sets → 2 groups');
check('--json groups the 3 and the 2, representatives are the fewest-findings member (tie by slug), same stays unchanged', () => {
  // card-c shares the band's fingerprint (same missing + COUNT/CLUSTERS probes) but carries one extra
  // SECTION-HEIGHTS delta (not part of the fingerprint) → more findings, so it is not the representative.
  const cardC = diff('card-c', ['promo', 'badge'], ['hero']);
  cardC.deltas = [...cardC.deltas, { kind: 'SECTION HEIGHTS', msg: 'hero 410 → 380px' }];
  ledger('card', [
    same('card-same'),
    diff('card-b', ['promo', 'badge'], ['hero']),
    diff('card-a', ['badge', 'promo'], ['hero']),            // same fingerprint as card-b/card-c, fewest findings, first by slug
    cardC,
    diff('card-e', ['masthead'], ['list']),
    diff('card-d', ['masthead'], ['list']),                  // tie with card-e → first by slug wins
  ]);
  const r = run(['retype-plan', 'card', '--json']); assert.equal(r.status, 0, r.err);
  const plan = JSON.parse(r.out);
  assert.equal(plan.archetype, 'card');
  assert.deepEqual(plan.unchanged, ['card-same']);
  assert.equal(plan.groups.length, 2);
  const g0 = plan.groups[0]; const g1 = plan.groups[1];
  assert.equal(g0.fingerprint, 'missing=[badge,promo]; shape=[hero]');
  assert.deepEqual(g0.siblings, ['card-a', 'card-b', 'card-c']);
  assert.equal(g0.representative, 'card-a');
  assert.equal(g1.fingerprint, 'missing=[masthead]; shape=[list]');
  assert.deepEqual(g1.siblings, ['card-d', 'card-e']);
  assert.equal(g1.representative, 'card-d');
  // findings carry the representative's missing/extra/deltas (an exemplar of why the group differs)
  assert.deepEqual(g1.findings.missing, ['masthead']);
  assert.ok(g1.findings.deltas.some((d) => d.kind === 'COUNT' && d.probe === 'list'));
  // retypePlan on the parsed doc matches the CLI
  const doc = JSON.parse(readFileSync(join(tmp, 'stardust/rollout/variance/card.json'), 'utf8'));
  assert.deepEqual(retypePlan(doc, 'card'), plan);
});
check('human summary names groups, representatives, members and the unchanged tail; no file written without --write', () => {
  const r = run(['retype-plan', 'card']); assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^retype-plan card: 2 sub-archetype group\(s\) from 5 differing sibling\(s\), 1 unchanged$/m);
  assert.match(r.out, /^group 1 — missing=\[badge,promo\]; shape=\[hero\]$/m);
  assert.match(r.out, /^  representative: card-a$/m);
  assert.match(r.out, /^  siblings: card-a, card-b, card-c$/m);
  assert.match(r.out, /^unchanged \(stay with card\): card-same$/m);
  assert.ok(!existsSync(planFile('card')), 'no plan file without --write');
});

// ---- (b) 2 distinct fingerprints → 2 singleton groups --------------------------------------------
console.log('(b) 2 siblings, distinct fingerprints → 2 singletons');
check('each differing sibling with its own fingerprint becomes a singleton group', () => {
  ledger('tile', [diff('tile-b', ['band'], ['hero']), diff('tile-a', ['masthead'], ['list'])]);
  const plan = JSON.parse(run(['retype-plan', 'tile', '--json']).out);
  assert.equal(plan.groups.length, 2);
  // groups are ordered by fingerprint string: `missing=[band]…` sorts before `missing=[masthead]…`
  assert.deepEqual(plan.groups.map((g) => g.siblings), [['tile-b'], ['tile-a']]);
  assert.deepEqual(plan.groups.map((g) => g.representative), ['tile-b', 'tile-a']);
  assert.deepEqual(plan.unchanged, []);
});

// ---- (c) --write twice → identical files, one decision row ---------------------------------------
console.log('(c) --write is idempotent');
check('two --write runs leave the plan file byte-identical with a single re-type decision row', () => {
  ledger('panel', [diff('panel-a', ['band'], ['hero']), diff('panel-b', ['band'], ['hero']), same('panel-c')]);
  const first = run(['retype-plan', 'panel', '--write']); assert.equal(first.status, 0, first.err);
  assert.match(first.out, /^wrote stardust\/migrate\/retype-plan\/panel\.json \(re-type decision: 1 row\(s\)\)$/m);
  const bytes1 = readFileSync(planFile('panel'));
  const second = run(['retype-plan', 'panel', '--write']); assert.equal(second.status, 0, second.err);
  const bytes2 = readFileSync(planFile('panel'));
  assert.ok(bytes1.equals(bytes2), 'the plan file is byte-identical on re-write');
  const plan = readPlan('panel');
  assert.equal(plan.migrationDecisions.length, 1, 'one decision row, never duplicated');
  assert.deepEqual(plan.migrationDecisions[0], { kind: 're-type', archetype: 'panel', groups: ['panel-a'], unchanged: ['panel-c'] });
  assert.equal(plan.groups[0].siblings.length, 2);
  // --json writes pure JSON to stdout, the write status to stderr
  const j = run(['retype-plan', 'panel', '--write', '--json']); assert.equal(j.status, 0, j.err);
  assert.doesNotThrow(() => JSON.parse(j.out), 'stdout is pure JSON under --json');
  assert.match(j.err, /^retype-plan panel: wrote stardust\/migrate\/retype-plan\/panel\.json \(re-type decision: 1 row\(s\)\)$/m);
  assert.ok(readFileSync(planFile('panel')).equals(bytes2), 'still byte-identical after a --json --write');
});

// ---- (d) unknown archetype / no ledger → exit 2 with the hint ------------------------------------
console.log('(d) no ledger / archetype unknown → exit 2');
check('a slug with no ledger exits 2 and names the command that writes the ledger', () => {
  const r = run(['retype-plan', 'ghost']); assert.equal(r.status, 2);
  assert.match(r.err, /^retype-plan ghost: no variance ledger stardust\/rollout\/variance\/ghost\.json \(archetype unknown or not probed\) — run: node stardust\/scripts\/replica\/sibling-variance\.mjs/m);
  assert.equal(r.out, '');
});
check('a malformed ledger (no siblings[]) exits 2 naming the producer; --variance-dir is honoured; a file-unsafe slug is a usage error', () => {
  const dir = join(tmp, 'alt-variance'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken.json'), '{"template":"broken"}\n');
  const r = run(['retype-plan', 'broken', '--variance-dir', 'alt-variance']); assert.equal(r.status, 2);
  assert.match(r.err, /^retype-plan broken: alt-variance\/broken\.json is not a variance ledger \(no siblings\[\]\) — re-run: node stardust\/scripts\/replica\/sibling-variance\.mjs/m);
  const bad = run(['retype-plan', '../evil']); assert.equal(bad.status, 1);
  assert.match(bad.err, /^usage error: retype-plan: "\.\.\/evil" is not a file-safe archetype slug/);
  const none = run(['retype-plan']); assert.equal(none.status, 1);
  assert.match(none.err, /^usage error: retype-plan <archetype-slug> \[--write\] \[--json\]/);
});

// ---- (e) --help exit 0, the subcommand documented ------------------------------------------------
console.log('(e) --help');
check('--help exits 0 and documents retype-plan', () => {
  const empty = mkdtempSync(join(tmpdir(), 'retype-help-'));
  const r = run(['--help'], empty); assert.equal(r.status, 0); assert.match(r.out, /usage/i);
  assert.match(r.out, /retype-plan <archetype>/);
  rmSync(empty, { recursive: true, force: true });
});

// ---- done -----------------------------------------------------------------------------------
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed, ${passed} passed` : `\nall checks passed (${passed})`);
process.exitCode = failed ? 1 : 0;
