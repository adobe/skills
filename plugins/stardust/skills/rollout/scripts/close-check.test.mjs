#!/usr/bin/env node
// Fixture test: rollout/scripts/close-check.mjs — the wave-close checklist over the shared
// post-rollout fixture (evals/_shared/fixture-post-rollout, copied to a temp dir that is not a git repo).
//
//   as-is      exit 1; the open rows are exactly learnings, review, dashboard, report; tracking [-], commit [~]
//              (not a repo); the fixture is byte-identical afterwards (a plain run writes nothing)
//   report     row 7 is REQUIRED: no report/*.md → [ ]; a file older than the wave start → [ ]; one without a
//              gate table or a report-check line → [ ]; a dated file with both → [x]
//   --fix      dashboard + review pack regenerated and [x]: review-pack.json has one row per delivered template
//              (3), every URL on the live host or the source host, no localhost / token; the report rendered with
//              status.mjs --markdown into report/<wave-ts>.md (gate table + report-check line → row 7 [x]; NEGATIVE:
//              it stayed [ ] "agent work" before); learnings still open → exit 1
//   usage      `[-] usage` copies stardust/usage.json's total (windows, requests, fresh / cache read / output);
//              absent → `usage: unknown` naming token-ledger.mjs; never a failing row
//   published  a residual flaggedFor delivery under archetypes[].published.<bp>.residuals[] (the published-origin
//              regime) refuses the bare none line too (NEGATIVE: only breakpoints.<bp> was scanned before)
//   learnings  a bare `- none this run (<ts>)` line is REFUSED while progress.json carries a residual flaggedFor
//              delivery newer than the wave start; a four-field entry dated in the wave closes the row → exit 0
//   rows       journal **Next:** ≠ status next → journal [ ]; no rollout start line → status [ ]; lastRun.at older
//              than the ledger's newest row → coverage [ ] (drift is a WARNING only); a review pack with a
//              localhost URL → review [ ]
//   --skip     status / learnings never skippable (exit 2); a row without --reason exit 2; `--skip dashboard
//              --reason` renders [~] and appends the reason to journal.md (audit trail)
//   contract   --json parses; --help exit 0; SUMMARY close-check … is the last stdout line; no fetch / no POST
//
// Usage: node plugins/stardust/skills/rollout/scripts/close-check.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { waveOf, learningsVerdict, reviewable } from './close-check.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, 'close-check.mjs');
const FIX = join(HERE, '..', '..', '..', 'evals', '_shared', 'fixture-post-rollout');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const src = readFileSync(CLI, 'utf8');
assert.ok(!/fetch\(|POST/.test(src), 'close-check is file-only: no fetch, no POST');

const fresh = () => { const T = mkdtempSync(join(tmpdir(), 'close-check-test-')); cpSync(FIX, T, { recursive: true }); return T; };
const run = (T, ...a) => spawnSync(process.execPath, [CLI, '--root', T, ...a], { encoding: 'utf8' });
const marks = (out) => Object.fromEntries(out.split('\n').filter((l) => /^\[.\] /.test(l)).map((l) => [l.slice(4).split(/[:.]/)[0].trim().split(' ')[0], l[1]]));
const treeHash = (dir) => { const h = createHash('sha1'); const walk = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { h.update(p.slice(dir.length)); h.update(readFileSync(p)); } } }; walk(dir); return h.digest('hex'); };

// pure helpers
const wave = waveOf(readFileSync(join(FIX, 'stardust', 'status.jsonl'), 'utf8').split('\n').filter(Boolean));
assert.equal(wave.start.ts, '2026-09-18T15:00:00Z'); assert.equal(wave.close.event, 'end'); assert.match(wave.close.next, /close-check\.mjs --fix/);
assert.equal(waveOf(['{"skill":"stardust:rollout","event":"end","ts":"2026-09-18T16:00:00Z","next":"x"}']).start, null, 'an end without a start is no wave');
const start = Date.parse('2026-09-18T15:00:00Z');
assert.equal(learningsVerdict(null, { start, residuals: [], deviations: [] }).ok, false);
assert.equal(learningsVerdict('- none this run (2026-09-18T16:20:00Z): no new failure classes', { start, residuals: [], deviations: [] }).ok, true, 'none line accepted with nothing open');
assert.equal(learningsVerdict('- none this run (2026-09-18T16:20:00Z): x', { start, residuals: [{ archetype: 'a', bp: '360', band: 'y 1–2' }], deviations: [] }).ok, false, 'none line refused while a residual is flagged for delivery');
assert.equal(learningsVerdict('- none this run (2026-09-17T16:20:00Z): x', { start, residuals: [], deviations: [] }).ok, false, 'a none line older than the wave does not count');
assert.equal(learningsVerdict('### Rail\n- failure class: capture-gap\n- evidence: 2026-09-18T16:12:00Z rail 403\n- proposed change: replica § x\n- status: pending\n', { start, residuals: [{ archetype: 'a', bp: '360', band: 'b' }], deviations: [] }).ok, true, 'a dated entry closes the row even with a residual open');
assert.equal(reviewable('https://main--x--y.aem.live/a', ['main--x--y.aem.live']), true);
assert.equal(reviewable('http://localhost:3000/a', []), false); assert.equal(reviewable('https://main--x--y.aem.live/a?token=abc', []), false);
assert.equal(reviewable('https://other.example/a', ['main--x--y.aem.live']), false, 'a host that is neither live nor source is not reviewable');

// (a) as-is
let T = fresh();
const before = treeHash(T);
let r = run(T);
assert.equal(r.status, 1, r.stdout);
let m = marks(r.stdout);
assert.deepEqual(Object.entries(m).filter(([, v]) => v === ' ').map(([k]) => k).sort(), ['dashboard', 'learnings', 'report', 'review'], `open rows: ${JSON.stringify(m)}`);
assert.equal(m.status, 'x'); assert.equal(m.journal, 'x'); assert.equal(m.coverage, 'x'); assert.equal(m.tracking, '-'); assert.equal(m.commit, '~');
assert.match(r.stdout, /→ write stardust\/rollout\/report\/2026-09-18T15-00-00Z\.md — the Phase H block: gate table first/);
assert.match(r.stdout, /ledger previewed\|live 4 = coverage deployed\|verified 4/);
assert.match(r.stdout, /→ node skills\/rollout\/scripts\/open-review-pairs\.mjs --per-template 1 --no-open/);
assert.match(r.stdout, /→ node skills\/rollout\/scripts\/dashboard\.mjs/);
assert.match(r.stdout, /may not say "closed"/);
assert.match(r.stdout.trim().split('\n').pop(), /^SUMMARY close-check ok=3 failed=4 exit=1 details=.*status\.jsonl$/);
assert.equal(treeHash(T), before, 'a plain run writes nothing');

// (b) --fix
r = run(T, '--fix');
assert.equal(r.status, 1, r.stdout);
m = marks(r.stdout);
assert.equal(m.review, 'x'); assert.equal(m.dashboard, 'x'); assert.equal(m.learnings, ' ');
assert.equal(m.report, 'x', '--fix renders the report with status.mjs --markdown (plugin layout)'); assert.match(r.stdout, /--fix status\.mjs --markdown → stardust\/rollout\/report\/2026-09-18T15-00-00Z\.md/);
{ const rendered = readFileSync(join(T, 'stardust', 'rollout', 'report', '2026-09-18T15-00-00Z.md'), 'utf8'); assert.match(rendered, /^\|.*gate/im, 'gate table first'); assert.match(rendered, /report-check: \d+ paths ls-verified/, 'report-check line'); }
assert.match(r.stdout, /\[-\] usage: unknown \(no stardust\/usage\.json — node skills\/stardust\/scripts\/token-ledger\.mjs renders it\)/, '[-] usage row, advisory');
rmSync(join(T, 'stardust', 'rollout', 'report'), { recursive: true, force: true }); // the row-7 sequence below starts from no report
const pack = json(join(T, 'stardust', 'rollout', 'review-pack.json'));
assert.equal(pack.rows.length, 3, 'one row per delivered template');
assert.deepEqual([...new Set(pack.rows.map((x) => x.template))].sort(), ['article', 'landing', 'program']);
for (const row of pack.rows) { assert.match(row.eds, /^https:\/\/main--larkspur-mutual--larkspur\.aem\.live\//); assert.match(row.source, /^https:\/\/www\.larkspurmutual\.example\//); }
const packMd = readFileSync(join(T, 'stardust', 'rollout', 'review-pack.md'), 'utf8');
assert.ok([...packMd.matchAll(/https?:\/\/[^\s|)]+/g)].every((u) => !/localhost|127\.0\.0\.1|token=/.test(u[0])), 'no localhost / token URL in the pack');
assert.ok(Date.parse(json(join(T, 'stardust', 'rollout', 'dashboard', 'data.json')).generatedAt) >= Date.parse('2026-09-18T16:05:00Z'));

// (c) learnings: a bare none line is refused; a dated entry closes the wave
appendFileSync(join(T, 'stardust', 'learnings.md'), '# Learnings\n\n- none this run (2026-09-18T16:20:00Z): no new failure classes; residuals: 1 (all classed), deviations: 0\n');
r = run(T);
assert.equal(r.status, 1); m = marks(r.stdout); assert.equal(m.learnings, ' ');
assert.match(r.stdout, /"none this run" refused — 1 row\(s\) newer than the wave start.*residual news__storm-season-checklist@360 y 3020–3590 flaggedFor delivery/);
appendFileSync(join(T, 'stardust', 'learnings.md'), '\n### Personalization rail outlives the gate\n- failure class: capture-gap (personalization endpoint answers 403 to headless clients)\n- evidence: article archetype 360 residual y 3020–3590 flaggedFor delivery, 2026-09-18T16:10:00Z\n- proposed change: skills/replica/reference/source-fidelity-gate.md § Residual logging format — capture-state rows outliving the gate open a ledger entry\n- status: pending\n');
r = run(T);
assert.equal(r.status, 1, 'learnings met, report still open'); m = marks(r.stdout); assert.equal(m.learnings, 'x'); assert.equal(m.report, ' ');
// [-] usage from usage.json (T13.4's ledger), copied
writeFileSync(join(T, 'stardust', 'usage.json'), JSON.stringify({ generatedAt: '2026-09-18T16:30:00Z', windows: [{ label: 'rollout w1' }, { label: 'unwindowed' }], total: { turns: 42, fresh: 1_250_000, cacheWrite: 10, cacheRead: 3_400_000, output: 88_000 } }));
r = run(T); assert.match(r.stdout, /\[-\] Usage  1 window\(s\) · 42 requests · fresh 1\.25 M · cache read 3\.40 M · output 88 k   \(usage\.json 2026-09-18T16:30:00Z\)/, 'usage line copied from usage.json');
assert.equal(marks(r.stdout).learnings, 'x', 'the usage row never changes a verdict');
// published-origin regime residual (NEGATIVE): a delivery-flagged residual under published.<bp> refuses the none line
{
  const T2 = fresh();
  const pp = join(T2, 'stardust', 'replica', 'progress.json'); const prog = json(pp);
  for (const a of prog.archetypes) for (const b of Object.values(a.breakpoints || {})) if (b && b.residuals) b.residuals = b.residuals.filter((x) => x.flaggedFor !== 'delivery');
  const art = prog.archetypes.find((a) => a.archetype === 'news__storm-season-checklist');
  art.published = { 1440: { pass: false, residuals: [{ band: 'y 900–1100', pct: 4.2, cause: 'capture-state: consent bar', flaggedFor: 'delivery', at: '2026-09-18T16:12:00Z' }] } };
  writeFileSync(pp, JSON.stringify(prog, null, 2));
  appendFileSync(join(T2, 'stardust', 'learnings.md'), '# Learnings\n\n- none this run (2026-09-18T16:20:00Z): no new failure classes; residuals: 1 (all classed), deviations: 0\n');
  const r2 = run(T2); assert.equal(marks(r2.stdout).learnings, ' ', 'a published-regime residual keeps row 4 open');
  assert.match(r2.stdout, /residual news__storm-season-checklist@1440 y 900–1100 flaggedFor delivery \(published-origin\)/);
  rmSync(T2, { recursive: true, force: true });
}
// report row: an old file, a file without the gate table / report-check line, then the real thing
const repDir = join(T, 'stardust', 'rollout', 'report'); mkdirSync(repDir, { recursive: true });
const reportMd = '# Wave 1 close\n\n| page | gate | 1440 | 360 |\n|---|---|---|---|\n| / | published-origin | PASS 2.1 % | PASS 3.9 % |\n\nreport-check: 3 paths ls-verified · 4 counts re-read from rollout.json, progress.json\n';
writeFileSync(join(repDir, '2026-09-17T10-00-00Z.md'), reportMd);
r = run(T); m = marks(r.stdout); assert.equal(m.report, ' ', 'a report older than the wave start does not close row 7'); assert.match(r.stdout, /is older than the wave start/);
writeFileSync(join(repDir, '2026-09-18T16-20-00Z.md'), '# Wave 1 close\n\nAll good.\n');
r = run(T); m = marks(r.stdout); assert.equal(m.report, ' ', 'no gate table / report-check line'); assert.match(r.stdout, /lacks a gate table or a `report-check:` line/);
writeFileSync(join(repDir, '2026-09-18T16-20-00Z.md'), reportMd);
r = run(T);
assert.equal(r.status, 0, r.stdout); m = marks(r.stdout); assert.equal(m.report, 'x');
assert.match(r.stdout, /^closed: every required row is met/m);
assert.match(r.stdout.trim().split('\n').pop(), /^SUMMARY close-check ok=7 failed=0 exit=0 /);
// --json
r = run(T, '--json'); const doc = JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('\nSUMMARY')));
assert.equal(doc.exit, 0); assert.equal(doc.wave.start, '2026-09-18T15:00:00Z'); assert.ok(doc.rows.some((x) => x.id === 'learnings' && x.mark === 'x'));
rmSync(T, { recursive: true, force: true });

// (d) rows that fail on their artifact
T = fresh();
const jp = join(T, 'stardust', 'journal.md');
writeFileSync(jp, readFileSync(jp, 'utf8').replace('**Next:** node skills/rollout/scripts/close-check.mjs --fix', '**Next:** something else'));
r = run(T); m = marks(r.stdout); assert.equal(m.journal, ' ', 'journal Next must equal the status next'); assert.match(r.stdout, /→ append the journal entry/);
const sp = join(T, 'stardust', 'status.jsonl');
writeFileSync(sp, readFileSync(sp, 'utf8').split('\n').filter((l) => !/stardust:rollout/.test(l)).join('\n'));
r = run(T); m = marks(r.stdout); assert.equal(m.status, ' ', 'no rollout start line'); assert.match(r.stdout, /no `stardust:rollout` start line/);
rmSync(T, { recursive: true, force: true });
T = fresh();
const cp = join(T, 'stardust', 'rollout', 'rollout.json'); const cfg = json(cp); cfg.lastRun.at = '2026-09-18T15:30:00Z'; writeFileSync(cp, JSON.stringify(cfg));
r = run(T); m = marks(r.stdout); assert.equal(m.coverage, ' ', 'coverage older than the ledger'); assert.match(r.stdout, /→ node skills\/rollout\/scripts\/update-coverage\.mjs --from-ledger/);
// drift is a warning, not a fail
cfg.lastRun.at = '2026-09-18T16:05:00Z'; writeFileSync(cp, JSON.stringify(cfg));
const lp = join(T, 'content', '.deploy-ledger.json'); const led = json(lp); delete led['/business']; writeFileSync(lp, JSON.stringify(led));
r = run(T); m = marks(r.stdout); assert.equal(m.coverage, 'x'); assert.match(r.stdout, /WARNING drift: ledger previewed\|live 3 vs coverage deployed\|verified 4/);
// review pack on localhost → [ ]
writeFileSync(join(T, 'stardust', 'rollout', 'review-pack.json'), JSON.stringify({ generatedAt: '2026-09-18T16:06:00Z', rows: ['landing', 'article', 'program'].map((t) => ({ template: t, source: 'https://www.larkspurmutual.example/', eds: 'http://localhost:3000/' })) }));
writeFileSync(join(T, 'stardust', 'rollout', 'review-pack.md'), '# pack\n');
r = run(T); m = marks(r.stdout); assert.equal(m.review, ' '); assert.match(r.stdout, /3 URL\(s\) not on the live\/source host/);
// review pack older than the last deployedAt → stale
writeFileSync(join(T, 'stardust', 'rollout', 'review-pack.json'), JSON.stringify({ generatedAt: '2026-09-18T15:00:00Z', rows: ['landing', 'article', 'program'].map((t) => ({ template: t, source: 'https://www.larkspurmutual.example/', eds: 'https://main--larkspur-mutual--larkspur.aem.live/' })) }));
r = run(T); m = marks(r.stdout); assert.equal(m.review, ' '); assert.match(r.stdout, /STALE/);
rmSync(T, { recursive: true, force: true });

// (e) --skip
T = fresh();
assert.equal(run(T, '--skip', 'learnings', '--reason', 'x').status, 2, 'learnings cannot be skipped');
assert.equal(run(T, '--skip', 'status', '--reason', 'x').status, 2, 'status cannot be skipped');
assert.equal(run(T, '--skip', 'review').status, 2, '--skip needs --reason');
assert.equal(run(T, '--skip', 'nope', '--reason', 'x').status, 2, 'unknown row');
r = run(T, '--skip', 'dashboard', '--reason', 'no dashboard on this host');
m = marks(r.stdout); assert.equal(m.dashboard, '~'); assert.match(r.stdout, /\[~\] dashboard: skipped — no dashboard on this host/);
assert.match(readFileSync(join(T, 'stardust', 'journal.md'), 'utf8'), /- close-check: row `dashboard` skipped — no dashboard on this host \(\d{4}-/);
rmSync(T, { recursive: true, force: true });

// usage
assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
assert.equal(spawnSync(process.execPath, [CLI, '--root', join(tmpdir(), 'no-such-dir-close-check')], { encoding: 'utf8' }).status, 2, 'no coverage → exit 2');
assert.ok(!existsSync(join(FIX, 'stardust', 'learnings.md')), 'the shared fixture stays without a ledger');
console.log('close-check.test: ok (as-is rows, --fix, none-this-run refusal, dated entry closes, report row required, artifact rows, --skip, usage)');
