#!/usr/bin/env node
// Fixture test: skills/extract/scripts/state-update.mjs (state-machine.md § File / § Concurrency /
// § Provenance validation, run-status.md, prep-mode.md § 5 are the rule) over the modular
// brand-surface fixture plus one synthesized record:
//   non-live record NOT marked extracted and listed with its reason · live records marked with
//   currentStatePath · merge-by-slug preserves prototypePath, migratedPath, handsOff, impeccable,
//   direction, flow keys, page type and status beyond `extracted` · status.jsonl gains exactly ONE
//   line · _crawl-log.json#visionCheck[] merged by slug keeping existing entries, _provenance first,
//   nothing else rewritten · the `Provenance: <live>/<total> live` line · --prep with live < total →
//   exit 1 + blocked line · --dry-run writes nothing · exit 2 without a pages dir · --help exits 0 ·
//   STRICT schema gate by default (a pre-schema-2 record validate-page.mjs FAILs is not marked
//   extracted); --legacy is the opt-in (D2) · a value flag followed by another flag is a usage error (D4).
// Usage: node plugins/stardust/evals/fixtures/state-update.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessRecords, mergeState, mergeVisionCheck, evidenceTable } from '../../skills/extract/scripts/state-update.mjs';

const SCRIPT = join(import.meta.dirname, '..', '..', 'skills', 'extract', 'scripts', 'state-update.mjs');
const FIX = join(import.meta.dirname, '..', 'lint', 'fixtures', 'brand-surface', 'modular');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const run = (args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
function project() {
  const root = mkdtempSync(join(tmpdir(), 'state-update-')); const out = join(root, 'stardust', 'current'); cpSync(FIX, out, { recursive: true });
  // a synthesized record: shape is right, live-render evidence is not (renderedBy missing, waitMs 0)
  const fake = readJson(join(out, 'pages', 'about.json')); fake.slug = 'contact'; fake.url = 'https://example.com/contact'; fake.title = 'Contact — Example'; fake._provenance = { ...fake._provenance, waitMs: 0 }; delete fake._provenance.renderedBy;
  writeFileSync(join(out, 'pages', 'contact.json'), JSON.stringify(fake));
  const state = join(root, 'stardust', 'state.json');
  writeFileSync(state, JSON.stringify({ _provenance: { writtenBy: 'stardust:prototype', writtenAt: '2026-09-17T10:00:00Z', stardustVersion: '0.24.0' }, site: { originUrl: 'https://example.com', deployUrl: 'https://main--ex--org.aem.page', extractedAt: '2026-09-17T09:00:00Z', pageCap: 5, totalDiscovered: 12, crawled: 2 }, direction: { resolvedAt: '2026-09-17T11:00:00Z', phrase: 'calmer', directionFile: 'stardust/direction.md', iaFidelity: 'reimagined' }, handsOff: true, flow: 'redesign', flowChosenAt: '2026-09-17T08:00:00Z', flowSource: 'user-phrase', impeccable: { skillDir: '/x/skills/impeccable', launcher: 'scripts/impeccable', version: '4.3.1', registryCommands: 23, probedAt: '2026-09-17T08:00:00Z', drift: [] }, customKey: { keep: 'me' }, pages: [
    { slug: 'index', url: 'https://example.com/', title: 'Old title', type: 'landing', status: 'prototyped', history: [{ status: 'extracted', at: '2026-09-17T09:00:00Z' }, { status: 'directed', at: '2026-09-17T11:00:00Z' }, { status: 'prototyped', at: '2026-09-17T12:00:00Z' }], stale: false, staleReason: null, currentStatePath: 'stardust/current/pages/index.json', prototypePath: 'stardust/prototypes/index-proposed.html', migratedPath: 'stardust/migrated/index.html', shapeBrief: 'stardust/prototypes/index-shape.md' },
    { slug: 'legacy', url: 'https://example.com/legacy', title: 'Legacy', type: null, status: 'extracted', history: [{ status: 'extracted', at: '2026-09-17T09:00:00Z' }], stale: false, staleReason: null, currentStatePath: 'stardust/current/pages/legacy.json', prototypePath: null, migratedPath: null },
  ] }, null, 2));
  writeFileSync(join(root, 'stardust', 'status.jsonl'), '{"ts":"2026-09-17T08:00:00Z","skill":"stardust:extract","phase":"2-capture","event":"end","detail":"3 pages"}\n');
  writeFileSync(join(root, 'vision.json'), JSON.stringify([{ slug: 'index', verdict: 'suspect', notes: 'MUST NOT overwrite the existing ok' }, { slug: 'pricing', verdict: 'ok', notes: 'plans grid matches' }, { slug: 'about', verdict: 'recaptured', notes: 'overlay on first pass' }]));
  return { root, out, state };
}

// ---- pure functions ----
const live = { slug: 'a', rec: { slug: 'a', _provenance: { renderedBy: 'playwright', fetchedAt: '2026-09-18T09:00:00Z', waitMode: 'medium', waitMs: 2500, httpStatus: 200 } } };
const recs = [{ file: 'a.json', rec: live.rec }, { file: 'b.json', rec: { slug: 'b', _provenance: { renderedBy: 'playwright', fetchedAt: 'x', waitMode: 'medium', waitMs: 0, httpStatus: 200 } } }, { file: 'c.json', rec: null }];
const a0 = assessRecords(recs);
assert.equal(a0[0].live, false, 'STRICT default: a pre-schema-2 record with live provenance is NOT live (validate-page.mjs FAILs it)');
assert.ok(a0[0].reasons.includes('_provenance.schemaVersion') && a0[0].reasons.includes('landmarks'), `strict reasons name the schema keys, got ${a0[0].reasons}`);
const a1 = assessRecords(recs, { legacy: true });
assert.equal(a1[0].live, true, '--legacy opt-in: the same record is live'); assert.equal(a1[1].live, false); assert.deepEqual(a1[1].reasons, ['_provenance.waitMs', '_provenance.fetchedAt']); assert.equal(a1[2].live, false);
const m1 = mergeState(null, a1, { outDir: 'stardust/current', now: 't', artifacts: {}, visionCount: 0 });
assert.deepEqual(Object.keys(m1.state), ['_provenance', 'site', 'direction', 'pages'], 'fresh state: canonical key order'); assert.equal(m1.state.direction, null);
assert.deepEqual(m1.marked, ['a']); assert.deepEqual(m1.unmarked.map((u) => u.slug), ['b', 'c']); assert.equal(m1.state.pages.length, 1); assert.equal(m1.state.pages[0].currentStatePath, 'stardust/current/pages/a.json'); assert.equal(m1.state.pages[0].status, 'extracted');
const v1 = mergeVisionCheck([{ slug: 'index', verdict: 'ok', notes: 'x' }], [{ slug: 'index', verdict: 'suspect' }, { slug: 'about', verdict: 'ok' }]);
assert.equal(v1.visionCheck.length, 2); assert.equal(v1.visionCheck[0].verdict, 'ok', 'existing entry kept'); assert.equal(v1.added, 1); assert.equal(v1.kept, 1);
assert.match(evidenceTable(a1)[0], /^slug\s+live\s+waitMode\s+waitMs\s+status\s+media\(img\/bg\)/);

// ---- full run: 3 live + 1 synthesized, existing state, vision file ----
const p = project();
const r1 = run(['--out', p.out, '--state', p.state, '--vision', join(p.root, 'vision.json')]);
assert.equal(r1.code, 0, `non-prep run exits 0 even with a non-live record\n${r1.out}`);
assert.match(r1.out, /^Provenance: 3\/4 live — not marked extracted: contact \(_provenance\.renderedBy, _provenance\.waitMs\)/m, 'Provenance line names the non-live slug and reason');
assert.match(r1.out, /^\s*contact\s+no\s+medium\s+0\s+200\s+2\/0\s+✗ _provenance\.renderedBy, _provenance\.waitMs/m, 'evidence table row for the non-live record');
assert.match(r1.out, /^\s*index\s+yes\s+medium\s+2500\s+200\s+3\/1/m, 'evidence table row for a live record (media img/bg)');
const s = readJson(p.state);
assert.equal(Object.keys(s)[0], '_provenance'); assert.equal(s._provenance.writtenBy, 'stardust:extract'); assert.equal(s._provenance.script, 'state-update.mjs'); assert.equal(s._provenance.stardustVersion, '0.24.0', 'stardustVersion carried over');
assert.deepEqual(Object.keys(s).slice(0, 3), ['_provenance', 'site', 'direction']); assert.equal(Object.keys(s).at(-1), 'pages');
assert.equal(s.site.originUrl, 'https://example.com'); assert.equal(s.site.deployUrl, 'https://main--ex--org.aem.page', 'deployUrl preserved'); assert.equal(s.site.pageCap, 5); assert.equal(s.site.totalDiscovered, 12); assert.equal(s.site.crawled, 3);
assert.deepEqual(s.site.extractPhases, { captured: true, visionChecked: true, brandSurface: false, docs: false, review: false, scripts: true }, 'extractPhases stamp (no brand surface / docs / review in this project)');
assert.equal(s.direction.phrase, 'calmer'); assert.equal(s.handsOff, true); assert.equal(s.flow, 'redesign'); assert.equal(s.impeccable.version, '4.3.1'); assert.deepEqual(s.customKey, { keep: 'me' }, 'unknown top-level key preserved');
const by = Object.fromEntries(s.pages.map((e) => [e.slug, e]));
assert.deepEqual(Object.keys(by).sort(), ['about', 'index', 'legacy', 'pricing'], 'live pages merged in, legacy entry kept, contact NOT added');
assert.equal(by.index.status, 'prototyped', 'status beyond extracted is never demoted'); assert.equal(by.index.prototypePath, 'stardust/prototypes/index-proposed.html'); assert.equal(by.index.migratedPath, 'stardust/migrated/index.html'); assert.equal(by.index.type, 'landing'); assert.equal(by.index.shapeBrief, 'stardust/prototypes/index-shape.md', 'unknown per-page key preserved'); assert.equal(by.index.title, 'Example — Build, ship, and own your work', 'title refreshed from the record'); assert.equal(by.index.history.length, 3);
assert.equal(by.pricing.status, 'extracted'); assert.equal(by.pricing.currentStatePath, join(p.out, 'pages', 'pricing.json')); assert.equal(by.pricing.type, null); assert.equal(by.pricing.prototypePath, null); assert.deepEqual(by.pricing.history.map((h) => h.status), ['extracted']);
assert.equal(by.legacy.status, 'extracted');
const lines = readFileSync(join(p.root, 'stardust', 'status.jsonl'), 'utf8').trim().split('\n'); assert.equal(lines.length, 2, 'exactly one line appended');
const last = JSON.parse(lines[1]); assert.equal(last.skill, 'stardust:extract'); assert.equal(last.phase, '6-state'); assert.equal(last.event, 'end'); assert.match(last.detail, /3\/4 live · 3 marked extracted · not marked: contact/); assert.equal(last.artifact, p.state); assert.equal(last.next, '$stardust direct');
const log = readJson(join(p.out, '_crawl-log.json')); assert.equal(Object.keys(log)[0], '_provenance'); assert.equal(log._provenance.writtenAt, '2026-09-18T09:05:00.000Z', 'log _provenance untouched');
assert.deepEqual(log.visionCheck.map((v) => [v.slug, v.verdict]), [['index', 'ok'], ['pricing', 'ok'], ['about', 'recaptured']], 'union by slug — existing index entry kept, two added');
assert.deepEqual(log.runs, readJson(join(FIX, '_crawl-log.json')).runs, 'runs[] untouched'); assert.equal(log.discovery.count, 12);

// ---- --prep with live < total → exit 1, blocked line, Provenance line; state still written ----
const p2 = project();
const r2 = run(['--out', p2.out, '--state', p2.state, '--prep']);
assert.equal(r2.code, 1, 'prep + non-live record → exit 1'); assert.match(r2.out, /^Provenance: 3\/4 live/m);
const l2 = readFileSync(join(p2.root, 'stardust', 'status.jsonl'), 'utf8').trim().split('\n'); assert.equal(l2.length, 2); const b2 = JSON.parse(l2[1]); assert.equal(b2.event, 'blocked'); assert.match(b2.detail, /prep run incomplete \(synthesis guard\)/); assert.equal(b2.next, '$stardust extract --refresh contact');
assert.equal(readJson(p2.state).pages.length, 4, 'state written (live pages marked) even on the blocked path');
// --prep with every record live → exit 0, next is direct --prep
const p3 = project(); spawnSync('rm', [join(p3.out, 'pages', 'contact.json')]);
const r3 = run(['--out', p3.out, '--state', p3.state, '--prep']); assert.equal(r3.code, 0, r3.out); assert.match(r3.out, /^Provenance: 3\/3 live \(every page has Playwright evidence\)/m);
assert.equal(JSON.parse(readFileSync(join(p3.root, 'stardust', 'status.jsonl'), 'utf8').trim().split('\n').at(-1)).next, '$stardust direct --prep');
// --dry-run writes nothing; fresh project without state.json; exit 2 without pages dir; --help
const p4 = project(); const before = readFileSync(p4.state, 'utf8'); const r4 = run(['--out', p4.out, '--state', p4.state, '--dry-run', '--vision', join(p4.root, 'vision.json')]); assert.equal(r4.code, 0); assert.equal(readFileSync(p4.state, 'utf8'), before, 'dry-run leaves state.json alone');
assert.equal(readFileSync(join(p4.root, 'stardust', 'status.jsonl'), 'utf8').trim().split('\n').length, 1, 'dry-run appends nothing'); assert.equal(readJson(join(p4.out, '_crawl-log.json')).visionCheck.length, 1, 'dry-run does not merge visionCheck');
const p5 = project(); spawnSync('rm', [p5.state, join(p5.root, 'stardust', 'status.jsonl')]); assert.equal(run(['--out', p5.out, '--state', p5.state]).code, 0); const s5 = readJson(p5.state); assert.equal(s5.direction, null); assert.equal(s5.site.originUrl, 'https://example.com'); assert.equal(s5.pages.length, 3); assert.ok(existsSync(join(p5.root, 'stardust', 'status.jsonl')), 'status.jsonl created on first write');
assert.equal(run(['--out', join(p5.root, 'nowhere'), '--state', p5.state]).code, 2, 'missing pages dir → exit 2'); assert.equal(run(['--bogus']).code, 2); assert.equal(run(['--help']).code, 0);
assert.match(run(['--help']).out, /--legacy/, '--help names --legacy');
const d4 = spawnSync(process.execPath, [SCRIPT, '--out', p5.out, '--state', '--dry-run'], { encoding: 'utf8', cwd: p5.root }); assert.equal(d4.status, 2, 'D4: a value flag followed by another flag is a usage error, not a swallowed --dry-run'); assert.match(d4.stderr, /--state needs a value/); assert.ok(!existsSync(join(p5.root, '--dry-run')), 'D4: nothing written to a file named after the flag');
const d4b = run(['--out', p5.out, '--state', p5.state, '--vision']); assert.equal(d4b.code, 2, 'D4: trailing value flag without a value → exit 2'); assert.match(d4b.out, /--vision needs a value/);

// ---- D2: strict schema gate by default; --legacy admits a pre-schema-2 record ----
const legacyProject = () => { const q = project(); const old = readJson(join(q.out, 'pages', 'about.json')); old.slug = 'archive'; old.url = 'https://example.com/archive'; delete old._provenance.schemaVersion; delete old.landmarks; delete old.stats; writeFileSync(join(q.out, 'pages', 'archive.json'), JSON.stringify(old)); return q; };
const p6 = legacyProject(); const r6 = run(['--out', p6.out, '--state', p6.state]);
assert.equal(r6.code, 0); assert.match(r6.out, /^Provenance: 3\/5 live — not marked extracted: .*archive \(landmarks, stats, _provenance\.schemaVersion\)/m, 'strict: the pre-schema-2 record is listed with the keys validate-page.mjs names');
assert.ok(!readJson(p6.state).pages.some((e) => e.slug === 'archive'), 'strict: not marked extracted');
const p7 = legacyProject(); const r7 = run(['--out', p7.out, '--state', p7.state, '--legacy']);
assert.equal(r7.code, 0); assert.match(r7.out, /^Provenance: 4\/5 live \(--legacy\) — not marked extracted: contact/m, '--legacy: admitted, the synthesized record still is not');
assert.equal(readJson(p7.state).pages.find((e) => e.slug === 'archive').status, 'extracted');

console.log('state-update test: ok');
