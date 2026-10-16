#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/token-ledger.mjs — the advisory usage ledger.
 * Run: node skills/stardust/scripts/test/token-ledger.test.mjs   (exit 1 on failure; no network)
 *
 * Fixture (fixtures/token-ledger/, synthetic — nothing here is a real session):
 *   project/stardust/status.jsonl — four migrate windows (plan 15:20→15:24 · per-page render 15:24→15:39 "6/6 pages
 *     rendered" · assets 15:39:25→15:39:50 · state and report 15:39:52→15:40:02).
 *   transcripts/sess-01.jsonl — a main transcript (cwd /work/example-project, model model-x): requests A and B each
 *     written twice with cumulative usage (→ dedupe by requestId), C once, one human prompt, one bare `continue` ack,
 *     one tool_result, one <system-reminder>, one cost-state line, and a late request D outside every window.
 *   transcripts/sess-01/subagents/agent-a1.jsonl — one subagent request written twice (→ 1 sub request).
 *   project-units/stardust/ — migrate plan + render windows and an open `rollout C-deliver` window; migrate/progress.json
 *     units plan, page (render); rollout/progress.json units foundation, home (archetype), cluster-a / cluster-b
 *     (concurrent: 10:25:10→10:45 and 10:30→10:50), cluster-c (pending, never started), final (running, no endedAt).
 *   transcripts-units/ — one request per unit (one shared by both clusters), one between the windows, a subagent
 *     request inside both clusters, a prompt before C-deliver and a `continue` ack inside cluster-a.
 *
 * Cases:
 *   (a) --transcripts on project/: windows from status.jsonl (4 + unwindowed), requests de-duplicated by requestId
 *       (4 main, not 6 lines; 1 subagent, not 2), the subagent column separate, prompts 2 / acks 1 (tool_result and
 *       <system-reminder> lines skipped), pages + tokens/page from the end detail, the cost-state line surfaced as
 *       session cost, the unwindowed row reconciling the late request;
 *   (b) no --transcripts and a HOME with no harness project dir → `usage: unknown`, exit 0, nothing written; the same
 *       for a --transcripts dir that does not exist;
 *   (c) --json schema keys; (d) a second run is byte-identical except generatedAt / writtenAt;
 *   (e) --dry-run writes nothing; the fixture tree is untouched; (f) a value flag followed by a flag exits 2;
 *   (g) --prices with fewer than four numbers → a note, no NaN; (h) a rollout wave closes the previous one;
 *   (i) harness cost sessions are counted over the summed list;
 *   (j) unit rows on project-units/: one per started unit, parent = the phase window holding its start, overlaps on
 *       the two concurrent clusters, pages / tokens/page from the unit, md rows directly under their phase row;
 *   (k) Σ phase rows + unwindowed = total — unit rows are a breakdown, never added;
 *   (l) a bare-record progress.json (one archetype's record, no units map) → the note, exit 0, other rows intact;
 *   (m) discovery through HOME/.<dot-dir>/projects/<mangled root>/ with a matching cwd (first in sorted order);
 *       a non-matching cwd → `usage: unknown`;
 *   (n) STARDUST_TRANSCRIPTS names the directory; --transcripts wins over it;
 *   (o) --help in an empty cwd: exit 0 within 15 s, nothing written;
 *   (p) unit timestamps with a +02:00 offset → the same unit rows (counts, parents, overlaps) as the UTC form;
 *       an unparsable startedAt → a `usage:` note, no row.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'token-ledger.mjs');
const FIX = join(here, 'fixtures', 'token-ledger');
const snapshot = (d) => { const out = {}; (function walk(p) { for (const e of readdirSync(p)) { const f = join(p, e); if (statSync(f).isDirectory()) walk(f); else out[relative(d, f)] = readFileSync(f); } })(d); return out; };
const tmp = mkdtempSync(join(tmpdir(), 'token-ledger-'));
const home = join(tmp, 'home');
const proj = join(tmp, 'project');
cpSync(join(FIX, 'project'), proj, { recursive: true });
const baseEnv = { ...process.env, HOME: home }; delete baseEnv.STARDUST_TRANSCRIPTS;
const runIn = (root, env, ...a) => spawnSync(process.execPath, [CLI, '--root', root, ...a], { encoding: 'utf8', env: { ...baseEnv, ...env } });
const run = (...a) => runIn(proj, {}, ...a);
const strip = (s) => s.replace(/"?(generatedAt|writtenAt)"?: ?"?[^",\n]+"?,?/g, '');
const before = snapshot(FIX);
try {
  // (b) unknown first: nothing to read, nothing written
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for /);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')) && !existsSync(join(proj, 'stardust', 'usage.json')), 'unknown writes nothing');
  r = run('--transcripts', join(tmp, 'no-such-dir'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(transcript directory .*no-such-dir does not exist/);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')), 'a missing transcripts dir writes nothing');

  // (a) with the fixture transcripts
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 4 window\(s\) \+ unwindowed · 4 requests \(1 subagent\) · fresh 2\.1 k · cache write 45\.0 k · cache read 382\.0 k · output 3\.9 k · est\. USD \d+\.\d\d · harness-reported USD 3\.21 \(session, not per phase\)/m);
  assert.ok(!/^usage: transcripts start/m.test(r.stdout), 'no retention hint on a 10-second gap');
  const j = JSON.parse(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  for (const k of ['_provenance', 'generatedAt', 'source', 'windows', 'total', 'harnessCost', 'units']) assert.ok(k in j, `usage.json has ${k}`);
  assert.equal(j.source.harness, 'transcripts-dir');
  assert.deepEqual(j.units, [], 'no progress.json → no unit rows');
  assert.equal(j.windows.length, 5, '4 windows + unwindowed');
  assert.equal(j.windows.at(-1).label, 'unwindowed');
  assert.deepEqual([j.total.turns, j.total.subRequests, j.total.prompts, j.total.acks], [4, 1, 2, 1], 'requestId dedupe (6 lines → 4 requests); sub separate (2 lines → 1); prompts/acks classified');
  assert.deepEqual([j.total.fresh, j.total.cacheWrite, j.total.cacheWrite1h, j.total.cacheWrite5m, j.total.cacheRead, j.total.output, j.total.thinking], [2150, 45000, 40000, 5000, 382000, 3920, 450], 'max-per-field per request, summed');
  assert.deepEqual([j.total.subRead, j.total.subOut], [523000, 8000]);
  const plan = j.windows.find((w) => w.label === 'migrate plan');
  assert.deepEqual([plan.turns, plan.pages, plan.tokensPerPage, plan.wallMin, plan.cacheWrite1h], [1, 6, Math.round((1200 + 40000 + 100000 + 900) / 6), 4, 40000]);
  const render = j.windows.find((w) => w.label === 'migrate per-page render');
  assert.deepEqual([render.turns, render.subRequests, render.pages, render.secondsPerPage], [1, 1, 6, 150]);
  const report = j.windows.find((w) => w.label === 'migrate state and report');
  assert.equal(report.tokensPerPage, null, 'no tokens → no tokens/page');
  const unw = j.windows.at(-1);
  assert.deepEqual([unw.turns, unw.prompts, unw.output], [1, 1, 20], 'late request D + the pre-window prompt land in unwindowed');
  assert.equal(j.harnessCost.totalCostUSD, 3.21);
  assert.equal(typeof j.total.estCost, 'number');
  const md = readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8');
  assert.ok(md.startsWith('<!-- stardust:provenance\n'), 'provenance block first');
  assert.match(md, /^\| migrate plan \| 2026-09-10T15:20:00Z \| 2026-09-10T15:24:12Z \| 4 \| 1 \| 0 \| 0 \| 1\.2 k \| 40\.0 k \(40\.0 k \/ 0\) \| 100\.0 k \| 900 \(50\) \| 0 \/ 0 \/ 0 \| 6 \| 23683 \| /m);
  assert.match(md, /^Harness-reported session cost \(not per phase\): USD 3\.21/m);
  assert.ok(!md.includes('↳'), 'no unit rows without progress.json');

  // (d) idempotent
  const md1 = strip(md); const j1 = strip(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8'));
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75,0.3,15', '--json');
  assert.equal(r.status, 0);
  assert.equal(strip(readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8')), md1, 'usage.md identical except timestamps');
  assert.equal(strip(readFileSync(join(proj, 'stardust', 'usage.json'), 'utf8')), j1, 'usage.json identical except timestamps');
  assert.equal(JSON.parse(r.stdout).total.turns, 4, '--json prints the record');

  // (f) a value flag followed by a flag is usage (exit 2), decided before anything is read
  r = run('--transcripts', '--dry-run');
  assert.equal(r.status, 2, `--transcripts --dry-run exits 2\n${r.stdout}${r.stderr}`); assert.match(r.stderr, /--transcripts needs a value, got --dry-run/);
  // (g) --prices with fewer than four numbers: the column is dropped with a printed note — never NaN
  r = run('--transcripts', join(FIX, 'transcripts'), '--prices', '3,3.75', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^usage: --prices ignored — needs four numbers/m, 'the note names the shape (stderr under --json)');
  assert.ok(!/NaN/.test(r.stdout) && !/NaN/.test(readFileSync(join(proj, 'stardust', 'usage.md'), 'utf8')), 'no NaN anywhere');
  assert.equal(JSON.parse(r.stdout).total.estCost, null, 'estCost null without valid prices');
  // (h) rollout: a new wave closes the previous one whether status lines say `rollout` or `stardust:rollout`
  //     (before the fix the closing keyed on the literal `stardust:rollout|` prefix, so a bare `rollout` never closed)
  const waves = join(tmp, 'waves');
  cpSync(join(FIX, 'project'), waves, { recursive: true });
  const lines = [
    { ts: '2026-09-10T15:20:00Z', skill: 'rollout', phase: 'wave 1', event: 'start' },
    { ts: '2026-09-10T15:30:00Z', skill: 'stardust:rollout', phase: 'wave 2', event: 'start' },
    { ts: '2026-09-10T15:39:52Z', skill: 'rollout', phase: 'wave 3', event: 'start' },
  ];
  writeFileSync(join(waves, 'stardust', 'status.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  r = runIn(waves, {}, '--transcripts', join(FIX, 'transcripts'), '--json');
  assert.equal(r.status, 0, r.stderr);
  const wv = JSON.parse(r.stdout).windows;
  assert.deepEqual(wv.filter((w) => w.label.startsWith('rollout')).map((w) => [w.label, w.to]), [['rollout wave 1', '2026-09-10T15:30:00Z'], ['rollout wave 2', '2026-09-10T15:39:52Z'], ['rollout wave 3', wv[2].to]], 'wave 1 and 2 close when the next wave starts');
  assert.notEqual(wv[2].to, null, 'the open last wave ends at the last request');
  // (i) harness cost sessions are counted over the same list that is summed (main + subagent cost-state lines)
  assert.equal(j.harnessCost.sessions, 1, 'fixture: one cost-state line in main, none in the subagent');

  // (j) recorded-unit rows
  const units = join(tmp, 'units');
  cpSync(join(FIX, 'project-units'), units, { recursive: true });
  r = runIn(units, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: 3 window\(s\) \+ unwindowed \+ 7 unit row\(s\) · 9 requests \(1 subagent\) · /m);
  const ju = JSON.parse(readFileSync(join(units, 'stardust', 'usage.json'), 'utf8'));
  const U = Object.fromEntries(ju.units.map((u) => [u.label, u]));
  assert.deepEqual(ju.units.map((u) => u.label), ['↳ migrate plan', '↳ migrate page', '↳ rollout foundation', '↳ rollout home', '↳ rollout cluster-a', '↳ rollout cluster-b', '↳ rollout final'], 'one row per started unit, by start time; the pending cluster-c has none');
  assert.deepEqual(ju.units.map((u) => u.parent), ['migrate plan', 'migrate render', ...Array(5).fill('rollout C-deliver')]);
  assert.deepEqual(ju.units.map((u) => u.overlaps), [[], [], [], [], ['cluster-b'], ['cluster-a'], []]);
  assert.deepEqual(ju.units.map((u) => u.kind), ['plan', 'render', 'foundation', 'archetype', 'cluster', 'cluster', 'final']);
  const [ca, cb, fd, fin] = ['↳ rollout cluster-a', '↳ rollout cluster-b', '↳ rollout foundation', '↳ rollout final'].map((l) => U[l]);
  assert.deepEqual([ca.turns, ca.subRequests, ca.prompts, ca.acks, ca.pages, ca.tokensPerPage], [2, 1, 1, 1, 2, (50200 + 60300) / 2], 'cluster-a: A1 + the shared request, the subagent request, the ack');
  assert.deepEqual([cb.turns, cb.subRequests, cb.pages, cb.tokensPerPage], [2, 1, 1, 60300 + 70200], 'cluster-b counts the shared request too');
  assert.deepEqual([fd.turns, fd.pages, fd.tokensPerPage], [1, null, null], 'no pages on the unit → no tokens/page');
  assert.deepEqual([fin.status, fin.from, fin.to, fin.turns], ['running', '2026-09-11T10:50:10Z', '2026-09-11T10:55:00Z', 1], 'no endedAt → ends at the last request (shown in UTC)');
  assert.deepEqual([U['↳ migrate plan'].tokensPerPage, U['↳ migrate page'].tokensPerPage], [11300 / 4, 20600 / 4]);
  const mdu = readFileSync(join(units, 'stardust', 'usage.md'), 'utf8');
  const order = mdu.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| window |') && !l.startsWith('| **total**')).map((l) => l.split(' | ')[0].slice(2));
  assert.deepEqual(order, ['migrate plan', '↳ migrate plan', 'migrate render', '↳ migrate page', 'rollout C-deliver', '↳ rollout foundation', '↳ rollout home', '↳ rollout cluster-a (overlaps 1)', '↳ rollout cluster-b (overlaps 1)', '↳ rollout final', 'unwindowed'], 'unit rows directly under their phase row');
  assert.match(mdu, /^ {4}- stardust\/rollout\/progress\.json$/m, 'the progress files are named in the provenance');

  // (k) Σ phase rows + unwindowed = total; unit rows are a breakdown, never added
  for (const k of ['turns', 'prompts', 'acks', 'fresh', 'cacheWrite', 'cacheRead', 'output', 'subRequests', 'subRead', 'subOut']) {
    assert.equal(ju.windows.reduce((a, w) => a + w[k], 0), ju.total[k], `Σ windows ${k} = total`);
  }
  assert.deepEqual([ju.total.turns, ju.total.fresh, ju.total.cacheWrite, ju.total.cacheRead, ju.total.output], [9, 1150, 3000, 365000, 2250], 'the total counts each request once');
  assert.equal(ju.units.reduce((a, u) => a + u.turns, 0), 9, 'unit turns: the shared request counts in both clusters, the unwindowed one in none');
  assert.deepEqual(ju.windows.map((w) => [w.label, w.turns]), [['migrate plan', 1], ['migrate render', 1], ['rollout C-deliver', 6], ['unwindowed', 1]], 'phase windows stay exclusive');

  // (l) a bare record (one archetype's, not the units map) → a printed note; other rows intact
  const bare = join(tmp, 'bare');
  cpSync(join(FIX, 'project-units'), bare, { recursive: true });
  writeFileSync(join(bare, 'stardust', 'rollout', 'progress.json'), JSON.stringify({ status: 'done', kind: 'archetype', templates: ['home'], pages: 1, startedAt: '2026-09-11T10:15:10Z', endedAt: '2026-09-11T10:25:00Z' }));
  r = runIn(bare, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: stardust\/rollout\/progress\.json has no units map — unit rows skipped$/m);
  const jb = JSON.parse(readFileSync(join(bare, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual(jb.units.map((u) => u.label), ['↳ migrate plan', '↳ migrate page'], 'the migrate units still render');
  assert.deepEqual(jb.windows, ju.windows, 'phase rows unchanged');
  r = runIn(bare, {}, '--transcripts', join(FIX, 'transcripts-units'), '--json');
  assert.match(r.stderr, /has no units map/, 'the note goes to stderr under --json');
  assert.deepEqual(JSON.parse(r.stdout).units.length, 2, 'stdout stays the record');
  // (p) unit timestamps written with an offset (`date -Iseconds` → +02:00) count what their UTC form counts;
  //     an unparsable one is noted and gets no row
  const off = join(tmp, 'offset');
  cpSync(join(FIX, 'project-units'), off, { recursive: true });
  const plus2 = (iso) => new Date(Date.parse(iso) + 7_200_000).toISOString().replace(/\.000Z$/, '+02:00');
  for (const f of ['rollout', 'migrate']) {
    const pj = join(off, 'stardust', f, 'progress.json'); const doc = JSON.parse(readFileSync(pj, 'utf8'));
    for (const u of Object.values(doc.units)) for (const k of ['startedAt', 'endedAt']) if (u[k]) u[k] = plus2(u[k]);
    if (f === 'rollout') doc.units.broken = { status: 'running', kind: 'cluster', startedAt: 'after lunch' };
    writeFileSync(pj, JSON.stringify(doc));
  }
  assert.match(readFileSync(join(off, 'stardust', 'rollout', 'progress.json'), 'utf8'), /"startedAt":"2026-09-11T12:25:10\+02:00"/, 'the copy really carries +02:00');
  r = runIn(off, {}, '--transcripts', join(FIX, 'transcripts-units'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: stardust\/rollout\/progress\.json unit broken has a startedAt\/endedAt that is not an ISO timestamp — its row is skipped$/m);
  const jo = JSON.parse(readFileSync(join(off, 'stardust', 'usage.json'), 'utf8'));
  assert.deepEqual(jo.units, ju.units, 'same rows, parents, overlaps and counts as the UTC form; timestamps shown in UTC');
  assert.deepEqual(jo.windows, ju.windows, 'phase rows unchanged');

  // (m) discovery: HOME/.<dot-dir>/projects/<root, non-alphanumerics as '-'>/ whose transcript carries cwd = root
  const home2 = join(tmp, 'home2');
  const mangled = proj.replace(/[^a-zA-Z0-9]/g, '-');
  const sess = readFileSync(join(FIX, 'transcripts', 'sess-01.jsonl'), 'utf8');
  const plant = (dot, cwd) => { const d = join(home2, dot, 'projects', mangled); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 's.jsonl'), sess.replaceAll('/work/example-project', JSON.stringify(cwd).slice(1, -1))); return d; };
  plant('.aharness', '/work/elsewhere');
  const found = plant('.someharness', proj);
  r = runIn(proj, { HOME: home2 }, '--json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const jd = JSON.parse(r.stdout);
  assert.deepEqual([jd.source.harness, jd.source.dir, jd.total.turns], ['discovered', found, 4], 'the first dot-dir whose transcript carries the root as cwd');
  rmSync(join(home2, '.someharness'), { recursive: true });
  r = runIn(proj, { HOME: home2 }, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: unknown \(no transcript directory for /, 'a non-matching cwd is not this project');

  // (n) STARDUST_TRANSCRIPTS names the directory; --transcripts wins over it
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(FIX, 'transcripts') }, '--json', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([JSON.parse(r.stdout).source.harness, JSON.parse(r.stdout).total.turns], ['env', 4]);
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(tmp, 'no-such-dir') }, '--transcripts', join(FIX, 'transcripts'), '--json', '--dry-run');
  assert.equal(JSON.parse(r.stdout).source.harness, 'transcripts-dir');
  r = runIn(proj, { STARDUST_TRANSCRIPTS: join(tmp, 'no-such-dir') }, '--dry-run');
  assert.equal(r.status, 0); assert.match(r.stdout, /^usage: unknown \(transcript directory .*no-such-dir does not exist/);

  // (e) dry-run, fixture untouched
  rmSync(join(proj, 'stardust', 'usage.md')); rmSync(join(proj, 'stardust', 'usage.json'));
  r = run('--transcripts', join(FIX, 'transcripts'), '--dry-run');
  assert.equal(r.status, 0); assert.match(r.stdout, /\(dry run\)$/m);
  assert.ok(!existsSync(join(proj, 'stardust', 'usage.md')), '--dry-run writes nothing');
  // (o) --help in an empty cwd: exit 0 within 15 s, nothing written
  const empty = mkdtempSync(join(tmpdir(), 'token-ledger-help-'));
  const t0 = Date.now();
  r = spawnSync(process.execPath, [CLI, '--help'], { cwd: empty, encoding: 'utf8', env: baseEnv, timeout: 15000 });
  const elapsed = Date.now() - t0; const wrote = readdirSync(empty); rmSync(empty, { recursive: true, force: true });
  assert.equal(r.status, 0); assert.ok(elapsed < 15000, `--help took ${elapsed} ms`); assert.deepEqual(wrote, [], '--help writes nothing');
  assert.match(r.stdout, /Exit codes: 0 always/); assert.match(r.stdout, /2 only for a\nvalue flag followed by another flag/);
  assert.match(r.stdout, /STARDUST_TRANSCRIPTS/); assert.match(r.stdout, /unit rows/i);
  assert.deepEqual(snapshot(FIX), before, 'fixture untouched');
  console.log('token-ledger test: ok (unknown → exit 0 no write; 4 windows + unwindowed; requestId dedupe 4 main / 1 sub; prompts 2 acks 1; pages + tokens/page; cost-state; idempotent; dry-run; unit rows 7 with parents + overlaps; Σ windows = total; bare record noted; offsets normalised; discovery; env; help)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
